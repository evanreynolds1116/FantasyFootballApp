import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, Lot } from "../model/types.js";
import { auctionSpotsRemaining } from "../selectors/budget.js";
import { wouldExceedPositionMax } from "../selectors/roster.js";
import type { Event } from "../events/types.js";
import { advanceAfterLotResolved } from "./auctionTransition.js";
import { awardAuctionLot } from "./award.js";
import type { ReduceResult } from "./result.js";

function returnToPool(state: DraftState, lot: Lot, ctx: Ctx): ReduceResult {
  const updatedLot: Lot = { ...lot, state: "returnedToPool" };
  const nextState = bumpVersion({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? updatedLot : l)) });
  const events: Event[] = [{ type: "lot:returned", lotId: lot.id, playerId: lot.playerId }];
  const advanced = advanceAfterLotResolved(nextState, ctx);
  return { state: advanced.state, events: [...events, ...advanced.events] };
}

/** Handles a lot whose initial bidding round closed with zero bids. */
export function handleNoBid(state: DraftState, lot: Lot, ctx: Ctx): ReduceResult {
  if (state.settings.noBidAction === "returnToPool") {
    return returnToPool(state, lot, ctx);
  }

  const nominator = lot.nominatedByTeamId;
  const player = state.players.find((p) => p.id === lot.playerId);
  const nominatorHasSpot = auctionSpotsRemaining(state, nominator) > 0;
  const nominatorAtMax = player ? wouldExceedPositionMax(state, nominator, player.position) : false;

  if (!nominatorHasSpot || nominatorAtMax) {
    return returnToPool(state, lot, ctx);
  }

  const awarded = awardAuctionLot(state, lot, nominator, state.settings.minBid, ctx);
  const advanced = advanceAfterLotResolved(awarded.state, ctx);
  return { state: advanced.state, events: [...awarded.events, ...advanced.events] };
}
