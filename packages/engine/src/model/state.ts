import type { DraftSettings } from "../settings/types.js";
import type { DraftState, Player, Team } from "./types.js";

export function createInitialState(
  settings: DraftSettings,
  teams: Team[],
  players: Player[],
): DraftState {
  return {
    settings,
    teams,
    players,
    phase: "setup",
    paused: false,
    breakEndsAt: null,
    version: 0,
    nextId: 1,

    auctionRound: 0,
    nominationTurnTeamId: null,
    nominationEndsAt: null,
    nominationRemainingMs: null,

    lots: [],
    bids: [],
    picks: [],

    snakePickTurnTeamId: null,
    snakePickEndsAt: null,
    snakePickRemainingMs: null,
    snakeRound: 0,
    snakeDirection: 1,
    snakeRoundTurnsTaken: 0,
    deferredPicks: [],

    makeupRound: 0,
    makeupRoundTurnsTaken: 0,

    unavailablePlayerIds: [],
    commishLog: [],
    resumeHoldUntil: null,
    queues: {},

    lastAwardOrPick: null,
  };
}

/**
 * Mints a deterministic, always-unique id (never reused, even after undo
 * removes the row it was assigned to) from the state's monotonic counter.
 * Returns the id plus the state with the counter advanced.
 */
export function allocateId(
  state: DraftState,
  prefix: string,
): { id: string; state: DraftState } {
  return {
    id: `${prefix}_${state.nextId}`,
    state: { ...state, nextId: state.nextId + 1 },
  };
}

/** Bumps the draft version. Call once per state-changing reduce() call. */
export function bumpVersion(state: DraftState): DraftState {
  return { ...state, version: state.version + 1 };
}
