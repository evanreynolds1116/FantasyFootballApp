import type { DeferredPick, DraftState, TeamId } from "@draft-app/engine";

/**
 * The slice of DraftState that has no natural row shape and no query value
 * outside "reconstruct this exact draft" — stored as one jsonb blob on the
 * `draft` row (`engine_state`) rather than as a column per field. Everything
 * else in DraftState lives in real tables (see loadDraftState.ts).
 */
export type EngineBookkeeping = {
  nextId: number;
  nominationTurnTeamId: TeamId | null;
  nominationEndsAt: number | null;
  nominationRemainingMs: number | null;
  snakePickTurnTeamId: TeamId | null;
  snakePickEndsAt: number | null;
  snakePickRemainingMs: number | null;
  snakeRound: number;
  snakeDirection: 1 | -1;
  snakeRoundTurnsTaken: number;
  deferredPicks: DeferredPick[];
  makeupRound: number;
  makeupRoundTurnsTaken: number;
  unavailablePlayerIds: string[];
  commishLog: DraftState["commishLog"];
  resumeHoldUntil: number | null;
  lastAwardOrPick: DraftState["lastAwardOrPick"];
};

export function extractBookkeeping(state: DraftState): EngineBookkeeping {
  return {
    nextId: state.nextId,
    nominationTurnTeamId: state.nominationTurnTeamId,
    nominationEndsAt: state.nominationEndsAt,
    nominationRemainingMs: state.nominationRemainingMs,
    snakePickTurnTeamId: state.snakePickTurnTeamId,
    snakePickEndsAt: state.snakePickEndsAt,
    snakePickRemainingMs: state.snakePickRemainingMs,
    snakeRound: state.snakeRound,
    snakeDirection: state.snakeDirection,
    snakeRoundTurnsTaken: state.snakeRoundTurnsTaken,
    deferredPicks: state.deferredPicks,
    makeupRound: state.makeupRound,
    makeupRoundTurnsTaken: state.makeupRoundTurnsTaken,
    unavailablePlayerIds: state.unavailablePlayerIds,
    commishLog: state.commishLog,
    resumeHoldUntil: state.resumeHoldUntil,
    lastAwardOrPick: state.lastAwardOrPick,
  };
}
