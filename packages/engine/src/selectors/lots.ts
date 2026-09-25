import type { DraftState, Lot, LotState, PlayerId } from "../model/types.js";

export const TERMINAL_LOT_STATES: ReadonlySet<LotState> = new Set([
  "awarded",
  "returnedToPool",
  "cancelled",
]);

export function isTerminalLot(lot: Lot): boolean {
  return TERMINAL_LOT_STATES.has(lot.state);
}

/** The active lot: the earliest-nominated lot not yet in a terminal state. */
export function currentLot(state: DraftState): Lot | undefined {
  return state.lots.find((l) => !isTerminalLot(l));
}

export function lotsInRound(state: DraftState, round: number): Lot[] {
  return state.lots.filter((l) => l.round === round);
}

export function isRoundComplete(state: DraftState, round: number): boolean {
  const lots = lotsInRound(state, round);
  return lots.length > 0 && lots.every(isTerminalLot);
}

export function isPlayerDrafted(state: DraftState, playerId: PlayerId): boolean {
  return state.picks.some((p) => p.playerId === playerId);
}

/** A player attached to a non-terminal lot can't be nominated again. */
export function isPlayerInFlight(state: DraftState, playerId: PlayerId): boolean {
  return state.lots.some((l) => l.playerId === playerId && !isTerminalLot(l));
}

export function isPlayerAvailable(state: DraftState, playerId: PlayerId): boolean {
  return (
    !isPlayerDrafted(state, playerId) &&
    !isPlayerInFlight(state, playerId) &&
    !state.unavailablePlayerIds.includes(playerId)
  );
}

export function availablePlayerIds(state: DraftState): PlayerId[] {
  return state.players.filter((p) => isPlayerAvailable(state, p.id)).map((p) => p.id);
}
