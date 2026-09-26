import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { afterReveal, endsAtFor } from "../clock.js";
import { allocateId, bumpVersion } from "../model/state.js";
import type { Bid, DraftState, Lot, TeamId } from "../model/types.js";
import { remainingBudget } from "../selectors/budget.js";
import { pickOne } from "../rng.js";
import type { Event, RevealedBid } from "../events/types.js";
import { effectiveBidAmount, evaluateTopBid, sortBidsDescending } from "./bidEvaluation.js";
import { advanceAfterLotResolved } from "./auctionTransition.js";
import { awardAuctionLot } from "./award.js";
import { ok, reject, type ReduceResult } from "./result.js";

function isAllIn(state: DraftState, teamId: TeamId, minRequired: number): boolean {
  return remainingBudget(state, teamId) < minRequired;
}

function draftNumberOf(state: DraftState, teamId: TeamId): number {
  return state.teams.find((t) => t.id === teamId)?.draftNumber ?? Number.POSITIVE_INFINITY;
}

/** `clockCtx` starts whatever comes next (after a reveal, if one is playing); `ctx` is the real time. */
function resolveFallback(state: DraftState, lot: Lot, tiedTeamIds: TeamId[], topAmount: number, ctx: Ctx, clockCtx: Ctx = ctx): ReduceResult {
  const method = state.settings.tieFallback;
  const fallbackLot: Lot = { ...lot, state: "fallback", tiedTeamIds };

  if (method === "commissionerDecides") {
    const nextState = bumpVersion({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? fallbackLot : l)) });
    return ok(nextState, []);
  }

  let winnerTeamId: TeamId;
  if (method === "randomDraw") {
    winnerTeamId = pickOne(tiedTeamIds, ctx.rng);
  } else if (method === "higherBudget") {
    winnerTeamId = [...tiedTeamIds].sort((a, b) => remainingBudget(state, b) - remainingBudget(state, a))[0] as TeamId;
  } else {
    // earlierTeamNumber
    winnerTeamId = [...tiedTeamIds].sort((a, b) => draftNumberOf(state, a) - draftNumberOf(state, b))[0] as TeamId;
  }

  const events: Event[] = [{ type: "lot:fallback", lotId: lot.id, method, winnerTeamId }];
  const nextState = bumpVersion({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? fallbackLot : l)) });
  const awarded = awardAuctionLot(nextState, fallbackLot, winnerTeamId, topAmount, ctx);
  const advanced = advanceAfterLotResolved(awarded.state, clockCtx);
  return { state: advanced.state, events: [...events, ...awarded.events, ...advanced.events] };
}

/**
 * Starts a new tie rebid round among `tiedTeamIds`, unless every tied team
 * is all-in (can't legally raise) or a configured round limit is reached —
 * in either case, the fallback decides immediately instead.
 */
export function startTieRebidRound(
  state: DraftState,
  lot: Lot,
  tiedTeamIds: TeamId[],
  nextRoundNumber: number,
  ctx: Ctx,
  clockCtx: Ctx = ctx,
): ReduceResult {
  const { topAmount } = evaluateTopBid(state, lot, tiedTeamIds, lot.tieRound);
  const amount = topAmount as number;
  const minRequired = amount + state.settings.tieMinRaise;

  const roundLimitReached = state.settings.maxTieRounds !== null && nextRoundNumber > state.settings.maxTieRounds;
  const allAllIn = tiedTeamIds.every((teamId) => isAllIn(state, teamId, minRequired));

  if (roundLimitReached || allAllIn) {
    return resolveFallback(state, lot, tiedTeamIds, amount, ctx, clockCtx);
  }

  const minBidPerTeam: Record<TeamId, number> = {};
  for (const teamId of tiedTeamIds) minBidPerTeam[teamId] = minRequired;

  const endsAt = endsAtFor(clockCtx.now, state.settings.tieClockSec);
  const nextLot: Lot = { ...lot, state: "tieRebid", tieRound: nextRoundNumber, tiedTeamIds, endsAt };
  const nextState = bumpVersion({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? nextLot : l)) });
  const events: Event[] = [
    { type: "lot:tie", lotId: lot.id, tiedTeamIds, minBidPerTeam, tieRound: nextRoundNumber, endsAt },
  ];
  return { state: nextState, events };
}

function allTiedHaveBidThisRound(state: DraftState, lot: Lot): boolean {
  return lot.tiedTeamIds.every((teamId) =>
    state.bids.some((b) => b.lotId === lot.id && b.teamId === teamId && b.tieRound === lot.tieRound && !b.superseded),
  );
}

/** Closes the current tie round: reveals every tied amount in full, then awards, opens the next round, or falls back. */
function evaluateTieRound(state: DraftState, lot: Lot, ctx: Ctx): ReduceResult {
  const { topAmount, winners, allBids } = evaluateTopBid(state, lot, lot.tiedTeamIds, lot.tieRound);
  const revealedBids: RevealedBid[] = sortBidsDescending(allBids);
  const revealEvent: Event = { type: "lot:tieRebidRevealed", lotId: lot.id, tieRound: lot.tieRound, bids: revealedBids };

  if (winners.length === 1) {
    // The tie's final result gets the same reveal as any other lot, so what comes next waits for it too.
    const next = afterReveal(ctx);
    const awarded = awardAuctionLot({ ...state, revealHoldUntil: next.now }, lot, winners[0] as string, topAmount as number, ctx);
    const advanced = advanceAfterLotResolved(awarded.state, next);
    return { state: advanced.state, events: [revealEvent, ...awarded.events, ...advanced.events] };
  }

  const next = startTieRebidRound(state, lot, winners, lot.tieRound + 1, ctx);
  return { state: next.state, events: [revealEvent, ...next.events] };
}

export function applyTieRebid(state: DraftState, action: Extract<Action, { type: "tie:rebid" }>, ctx: Ctx): ReduceResult {
  const lot = state.lots.find((l) => l.id === action.lotId);
  if (!lot || lot.state !== "tieRebid" || (lot.endsAt !== null && ctx.now >= lot.endsAt)) {
    return reject(state, action, "LOT_CLOSED", "This lot is not in an open tie-rebid round.");
  }
  if (!lot.tiedTeamIds.includes(action.teamId)) {
    return reject(state, action, "NOT_ELIGIBLE", "This team is not part of the current tie.");
  }

  const ownPrevious = effectiveBidAmount(state, lot, action.teamId, lot.tieRound - 1) as number;
  const minRequired = ownPrevious + state.settings.tieMinRaise;
  if (action.amount < minRequired) {
    return reject(state, action, "BID_TOO_LOW", "Rebid must beat your previous bid by at least the minimum tie raise.");
  }
  if (action.amount > remainingBudget(state, action.teamId)) {
    return reject(state, action, "OVER_BUDGET", "Rebid exceeds remaining budget.");
  }

  const { id, state: withId } = allocateId(state, "bid");
  const supersededBids = withId.bids.map((b) =>
    b.lotId === lot.id && b.teamId === action.teamId && b.tieRound === lot.tieRound && !b.superseded
      ? { ...b, superseded: true }
      : b,
  );
  const newBid: Bid = {
    id,
    lotId: lot.id,
    teamId: action.teamId,
    tieRound: lot.tieRound,
    amount: action.amount,
    receivedAt: ctx.now,
    superseded: false,
  };
  let nextState = bumpVersion({ ...withId, bids: [...supersededBids, newBid] });
  const events: Event[] = [{ type: "lot:bidStatus", lotId: lot.id, teamId: action.teamId, hasBid: true }];

  if (allTiedHaveBidThisRound(nextState, lot)) {
    const result = evaluateTieRound(nextState, lot, ctx);
    return { state: result.state, events: [...events, ...result.events] };
  }

  return ok(nextState, events);
}

export function applyTieExpired(state: DraftState, action: Extract<Action, { type: "clock:tieExpired" }>, ctx: Ctx): ReduceResult {
  const lot = state.lots.find((l) => l.id === action.lotId);
  if (!lot || lot.state !== "tieRebid") {
    return ok(state, []);
  }
  return evaluateTieRound(state, lot, ctx);
}

export function applyResolveTie(state: DraftState, action: Extract<Action, { type: "admin:resolveTie" }>, ctx: Ctx): ReduceResult {
  const lot = state.lots.find((l) => l.id === action.lotId);
  if (!lot || lot.state !== "fallback" || state.settings.tieFallback !== "commissionerDecides") {
    return reject(state, action, "NOT_TIE_FALLBACK", "This lot is not awaiting a commissioner tie-break decision.");
  }
  if (!lot.tiedTeamIds.includes(action.teamId)) {
    return reject(state, action, "NOT_TIE_FALLBACK", "That team is not one of the tied teams.");
  }

  const { topAmount } = evaluateTopBid(state, lot, lot.tiedTeamIds, lot.tieRound);
  const events: Event[] = [
    { type: "lot:fallback", lotId: lot.id, method: "commissionerDecides", winnerTeamId: action.teamId },
  ];
  const awarded = awardAuctionLot(state, lot, action.teamId, topAmount as number, ctx);
  const advanced = advanceAfterLotResolved(awarded.state, ctx);
  return { state: advanced.state, events: [...events, ...awarded.events, ...advanced.events] };
}
