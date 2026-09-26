import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, Lot } from "../model/types.js";
import { isPlayerDrafted, isPlayerInFlight } from "../selectors/lots.js";
import type { Event } from "../events/types.js";
import { advanceAfterLotResolved } from "./auctionTransition.js";
import { logEdit } from "./rosterAdmin.js";
import { reject, type ReduceResult } from "./result.js";

/**
 * SPEC edge case "late-breaking injury": the lot being bid on (or tie
 * re-bid) is cancelled, nobody gets the player, and play moves on as if the
 * lot had been decided. The player goes back in the pool unless the
 * commissioner also marks them unavailable. Bids on it are never revealed.
 */
export function applyVoidLot(state: DraftState, action: Extract<Action, { type: "admin:voidLot" }>, ctx: Ctx): ReduceResult {
  const lot = state.lots.find((l) => l.id === action.lotId);
  if (!lot || (lot.state !== "open" && lot.state !== "tieRebid")) {
    return reject(state, action, "LOT_CLOSED", "Only a lot that's being bid on (or in a tie re-bid) can be voided.");
  }
  const voidedLot: Lot = { ...lot, state: "cancelled", endsAt: null, remainingMs: null };
  const logged = logEdit({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? voidedLot : l)) }, { kind: "void", lotId: lot.id, playerId: lot.playerId }, ctx);
  const events: Event[] = [{ type: "lot:cancelled", lotId: lot.id, playerId: lot.playerId }, logged.event];
  const advanced = advanceAfterLotResolved(bumpVersion(logged.state), ctx);
  return { state: advanced.state, events: [...events, ...advanced.events] };
}

export function applyMarkPlayerUnavailable(
  state: DraftState,
  action: Extract<Action, { type: "admin:markPlayerUnavailable" }>,
  ctx: Ctx,
): ReduceResult {
  if (!state.players.some((p) => p.id === action.playerId)) return reject(state, action, "INVALID_EDIT", "Unknown player.");
  if (state.unavailablePlayerIds.includes(action.playerId)) return reject(state, action, "INVALID_EDIT", "This player is already marked unavailable.");
  if (isPlayerDrafted(state, action.playerId) || isPlayerInFlight(state, action.playerId)) {
    return reject(state, action, "PLAYER_TAKEN", "This player is already picked or currently up for bid.");
  }
  const logged = logEdit({ ...state, unavailablePlayerIds: [...state.unavailablePlayerIds, action.playerId] }, { kind: "unavailable", playerId: action.playerId }, ctx);
  const events: Event[] = [{ type: "player:unavailable", playerId: action.playerId }, logged.event];
  return { state: bumpVersion(logged.state), events };
}

/** Undoes "unavailable" — a wrong tap, or the injury news changed. */
export function applyMarkPlayerAvailable(state: DraftState, action: Extract<Action, { type: "admin:markPlayerAvailable" }>, ctx: Ctx): ReduceResult {
  if (!state.unavailablePlayerIds.includes(action.playerId)) return reject(state, action, "INVALID_EDIT", "This player isn't marked unavailable.");
  const logged = logEdit(
    { ...state, unavailablePlayerIds: state.unavailablePlayerIds.filter((id) => id !== action.playerId) },
    { kind: "available", playerId: action.playerId },
    ctx,
  );
  return { state: bumpVersion(logged.state), events: [logged.event] };
}
