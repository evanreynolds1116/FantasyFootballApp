import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { allocateId, bumpVersion } from "../model/state.js";
import type { DraftState, Lot } from "../model/types.js";
import { canNominate } from "../selectors/eligibility.js";
import { availablePlayerIds, isPlayerAvailable, lotsInRound } from "../selectors/lots.js";
import { eligibleNominationOrderForRound } from "../selectors/order.js";
import type { Event } from "../events/types.js";
import { openLot } from "./auctionTransition.js";
import { ok, reject, type ReduceResult } from "./result.js";

function createQueuedLot(
  state: DraftState,
  playerId: string,
  nominatedByTeamId: string,
): { lot: Lot; state: DraftState } {
  const { id, state: withId } = allocateId(state, "lot");
  const round = withId.auctionRound;
  const orderInRound = lotsInRound(withId, round).length + 1;
  const lot: Lot = {
    id,
    round,
    orderInRound,
    playerId,
    nominatedByTeamId,
    state: "queued",
    tieRound: 0,
    endsAt: null,
    remainingMs: null,
    eligibleTeamIds: [],
    tiedTeamIds: [],
    winnerTeamId: null,
    price: null,
  };
  return { lot, state: withId };
}

/** After a nomination lands, either advance to the next nominator or, if the round's nominations are all in, open lot 1 for bidding. */
function afterNomination(state: DraftState, lot: Lot, ctx: Ctx, priorEvents: Event[]): ReduceResult {
  let nextState = bumpVersion({ ...state, lots: [...state.lots, lot] });
  const events: Event[] = [
    ...priorEvents,
    {
      type: "nomination:made",
      lotId: lot.id,
      playerId: lot.playerId,
      teamId: lot.nominatedByTeamId,
      round: lot.round,
      orderInRound: lot.orderInRound,
    },
  ];

  const order = eligibleNominationOrderForRound(nextState, nextState.auctionRound);
  const roundLotCount = lotsInRound(nextState, nextState.auctionRound).length;

  if (roundLotCount >= order.length) {
    // All eligible teams have nominated this round: open lot 1 for bidding.
    nextState = {
      ...nextState,
      nominationTurnTeamId: null,
      nominationEndsAt: null,
      nominationRemainingMs: null,
    };
    const firstLot = [...lotsInRound(nextState, nextState.auctionRound)].sort(
      (a, b) => a.orderInRound - b.orderInRound,
    )[0];
    if (firstLot) {
      const opened = openLot(nextState, firstLot, ctx);
      return { state: opened.state, events: [...events, ...opened.events] };
    }
    return { state: nextState, events };
  }

  const nextTeamId = order[roundLotCount] as string;
  const nominationEndsAt =
    nextState.settings.nominationClockSec === "off" ? null : ctx.now + nextState.settings.nominationClockSec * 1000;
  nextState = { ...nextState, nominationTurnTeamId: nextTeamId, nominationEndsAt, nominationRemainingMs: null };
  events.push({ type: "nomination:turn", teamId: nextTeamId, endsAt: nominationEndsAt });
  return { state: nextState, events };
}

export function applyNominate(state: DraftState, action: Extract<Action, { type: "nominate" }>, ctx: Ctx): ReduceResult {
  if (state.phase !== "auction") return reject(state, action, "INVALID_PHASE", "Auction is not the current phase.");
  if (action.teamId !== state.nominationTurnTeamId) {
    return reject(state, action, "NOT_YOUR_TURN", "It is not this team's turn to nominate.");
  }
  if (!isPlayerAvailable(state, action.playerId)) {
    return reject(state, action, "PLAYER_TAKEN", "This player is not available.");
  }
  if (!canNominate(state, action.teamId)) {
    return reject(state, action, "NOT_ELIGIBLE", "This team cannot nominate right now.");
  }

  const { lot, state: withLot } = createQueuedLot(state, action.playerId, action.teamId);
  return afterNomination(withLot, lot, ctx, []);
}

export function applyNominationExpired(
  state: DraftState,
  action: Extract<Action, { type: "clock:nominationExpired" }>,
  ctx: Ctx,
): ReduceResult {
  if (state.phase !== "auction" || !state.nominationTurnTeamId) {
    return ok(state, []);
  }
  const teamId = state.nominationTurnTeamId;
  // Placeholder auto-nominate ranking: player-pool insertion order (no ADP/watchlist data in phase 1).
  const available = availablePlayerIds(state);
  if (available.length === 0) {
    return ok(state, []);
  }
  const playerId = available[0] as string;
  const { lot, state: withLot } = createQueuedLot(state, playerId, teamId);
  return afterNomination(withLot, lot, ctx, []);
}
