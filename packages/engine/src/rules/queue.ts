import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState } from "../model/types.js";
import type { Event } from "../events/types.js";
import { reject, type ReduceResult } from "./result.js";

/** Long enough for any real queue; bounds what one intent can store. */
export const MAX_QUEUE_LENGTH = 200;

/**
 * Replaces a manager's queue (FR-19). Allowed in every phase and while
 * paused — it's a manager's own prep, not a draft move. Duplicates are
 * dropped (first occurrence wins); unknown players are refused. The event
 * is private to that team: the server sends it only to that manager.
 */
export function applyQueueUpdate(state: DraftState, action: Extract<Action, { type: "queue:update" }>, _ctx: Ctx): ReduceResult {
  if (!state.teams.some((t) => t.id === action.teamId)) {
    return reject(state, action, "INVALID_QUEUE", "Unknown team.");
  }
  const known = new Set(state.players.map((p) => p.id));
  const playerIds = [...new Set(action.playerIds)];
  if (playerIds.some((id) => !known.has(id))) {
    return reject(state, action, "INVALID_QUEUE", "The queue has a player who isn't in this draft's pool.");
  }
  if (playerIds.length > MAX_QUEUE_LENGTH) {
    return reject(state, action, "INVALID_QUEUE", `A queue can hold at most ${MAX_QUEUE_LENGTH} players.`);
  }
  const nextState = bumpVersion({ ...state, queues: { ...state.queues, [action.teamId]: playerIds } });
  const events: Event[] = [{ type: "queue:updated", teamId: action.teamId, playerIds }];
  return { state: nextState, events };
}
