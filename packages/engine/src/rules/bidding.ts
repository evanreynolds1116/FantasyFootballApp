import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { EARLY_CLOSE_LAST_CHANCE_MS } from "../clock.js";
import { allocateId, bumpVersion } from "../model/state.js";
import type { Bid, DraftState, Lot } from "../model/types.js";
import { remainingBudget } from "../selectors/budget.js";
import type { Event } from "../events/types.js";
import { ok, reject, type ReduceResult } from "./result.js";

function activeBidsForRound(state: DraftState, lot: Lot) {
  return state.bids.filter((b) => b.lotId === lot.id && b.tieRound === lot.tieRound && !b.superseded);
}

function allEligibleHaveBid(state: DraftState, lot: Lot): boolean {
  const active = activeBidsForRound(state, lot);
  return lot.eligibleTeamIds.every((teamId) => active.some((b) => b.teamId === teamId));
}

export function applyBidSubmit(state: DraftState, action: Extract<Action, { type: "bid:submit" }>, ctx: Ctx): ReduceResult {
  const lot = state.lots.find((l) => l.id === action.lotId);
  if (!lot || lot.state !== "open" || (lot.endsAt !== null && ctx.now >= lot.endsAt)) {
    return reject(state, action, "LOT_CLOSED", "This lot is not open for bidding.");
  }
  if (!lot.eligibleTeamIds.includes(action.teamId)) {
    return reject(state, action, "NOT_ELIGIBLE", "This team is not eligible to bid on this lot.");
  }
  if (action.amount < state.settings.minBid || action.amount % state.settings.bidStep !== 0) {
    return reject(state, action, "BID_TOO_LOW", "Bid is below the minimum or not a valid bid-step increment.");
  }
  if (action.amount > remainingBudget(state, action.teamId)) {
    return reject(state, action, "OVER_BUDGET", "Bid exceeds remaining budget.");
  }

  const hadAllBid = allEligibleHaveBid(state, lot);

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

  let nextLot = lot;
  const events: Event[] = [{ type: "lot:bidStatus", lotId: lot.id, teamId: action.teamId, hasBid: true }];

  let nextState = bumpVersion({ ...withId, bids: [...supersededBids, newBid] });

  const hasAllBidNow = allEligibleHaveBid(nextState, lot);
  if (!hadAllBid && hasAllBidNow && state.settings.earlyClose) {
    const closingEndsAt = ctx.now + EARLY_CLOSE_LAST_CHANCE_MS;
    nextLot = { ...lot, endsAt: closingEndsAt };
    nextState = { ...nextState, lots: nextState.lots.map((l) => (l.id === lot.id ? nextLot : l)) };
    events.push({ type: "lot:closing", lotId: lot.id, endsAt: closingEndsAt });
  }

  return ok(nextState, events);
}
