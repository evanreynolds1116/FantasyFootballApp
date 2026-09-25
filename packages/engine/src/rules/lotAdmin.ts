import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, Lot } from "../model/types.js";
import { isPlayerDrafted, isPlayerInFlight } from "../selectors/lots.js";
import type { Event } from "../events/types.js";
import { advanceAfterLotResolved } from "./auctionTransition.js";
import { reject, type ReduceResult } from "./result.js";

export function applyVoidLot(state: DraftState, action: Extract<Action, { type: "admin:voidLot" }>, ctx: Ctx): ReduceResult {
  const lot = state.lots.find((l) => l.id === action.lotId);
  if (!lot || lot.state !== "open") {
    return reject(state, action, "LOT_CLOSED", "Only an open lot can be voided.");
  }
  const voidedLot: Lot = { ...lot, state: "cancelled" };
  const nextState = bumpVersion({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? voidedLot : l)) });
  const events: Event[] = [{ type: "lot:cancelled", lotId: lot.id, playerId: lot.playerId }];
  const advanced = advanceAfterLotResolved(nextState, ctx);
  return { state: advanced.state, events: [...events, ...advanced.events] };
}

export function applyMarkPlayerUnavailable(
  state: DraftState,
  action: Extract<Action, { type: "admin:markPlayerUnavailable" }>,
  _ctx: Ctx,
): ReduceResult {
  if (isPlayerDrafted(state, action.playerId) || isPlayerInFlight(state, action.playerId)) {
    return reject(state, action, "PLAYER_TAKEN", "This player is already picked or currently up for bid.");
  }
  const nextState = bumpVersion({
    ...state,
    unavailablePlayerIds: [...state.unavailablePlayerIds, action.playerId],
  });
  const events: Event[] = [{ type: "player:unavailable", playerId: action.playerId }];
  return { state: nextState, events };
}
