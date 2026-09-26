import type { Action } from "../actions/types.js";
import { afterReveal, type Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, Lot } from "../model/types.js";
import type { Event, RevealedBid } from "../events/types.js";
import { evaluateTopBid, sortBidsDescending } from "./bidEvaluation.js";
import { advanceAfterLotResolved } from "./auctionTransition.js";
import { awardAuctionLot } from "./award.js";
import { handleNoBid } from "./noBid.js";
import { startTieRebidRound } from "./tie.js";
import { ok, type ReduceResult } from "./result.js";

/** Truncates a descending-sorted bid list per the revealTopN setting. */
export function applyRevealTopN(bids: RevealedBid[], revealTopN: number | "all"): RevealedBid[] {
  if (revealTopN === "all") return bids;
  return bids.slice(0, revealTopN);
}

function closeInitialLot(state: DraftState, lot: Lot, ctx: Ctx): ReduceResult {
  const { topAmount, winners, allBids } = evaluateTopBid(state, lot, lot.eligibleTeamIds, 0);
  // Recorded so what counts as revealed never changes if the setting is changed mid-draft.
  const closedLot: Lot = { ...lot, state: "closed", revealTopN: state.settings.revealTopN };
  let nextState = bumpVersion({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? closedLot : l)) });

  const revealedBids = applyRevealTopN(
    sortBidsDescending(allBids),
    nextState.settings.revealTopN,
  );
  const winnerTeamId = winners.length === 1 ? (winners[0] as string) : null;
  const passes = state.bids.filter((b) => b.lotId === lot.id && b.tieRound === 0 && !b.superseded && b.pass).length;
  const revealEvent: Event = { type: "lot:reveal", lotId: lot.id, bids: revealedBids, winnerTeamId, passes };
  const next = afterReveal(ctx);
  nextState = { ...nextState, revealHoldUntil: next.now };

  if (allBids.length === 0) {
    const revealedLot: Lot = { ...closedLot, state: "revealed" };
    nextState = { ...nextState, lots: nextState.lots.map((l) => (l.id === lot.id ? revealedLot : l)) };
    const result = handleNoBid(nextState, revealedLot, ctx, next);
    return { state: result.state, events: [revealEvent, ...result.events] };
  }

  const revealedLot: Lot = { ...closedLot, state: "revealed" };
  nextState = { ...nextState, lots: nextState.lots.map((l) => (l.id === lot.id ? revealedLot : l)) };

  if (winners.length === 1) {
    const awarded = awardAuctionLot(nextState, revealedLot, winners[0] as string, topAmount as number, ctx);
    const advanced = advanceAfterLotResolved(awarded.state, next);
    return { state: advanced.state, events: [revealEvent, ...awarded.events, ...advanced.events] };
  }

  // Tie: multiple teams share the top bid.
  const tieResult = startTieRebidRound(nextState, revealedLot, winners, 1, ctx, next);
  return { state: tieResult.state, events: [revealEvent, ...tieResult.events] };
}

export function applyLotExpired(state: DraftState, action: Extract<Action, { type: "clock:lotExpired" }>, ctx: Ctx): ReduceResult {
  const lot = state.lots.find((l) => l.id === action.lotId);
  if (!lot || lot.state !== "open") {
    return ok(state, []);
  }
  return closeInitialLot(state, lot, ctx);
}
