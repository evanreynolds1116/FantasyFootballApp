import type { Action } from "../actions/types.js";
import type { ErrorCode } from "../errors.js";
import type { Event } from "../events/types.js";
import type { DraftState } from "../model/types.js";

export type ReduceResult = { state: DraftState; events: Event[] };

/** A rejection: state unchanged (by reference), one draft:rejected event. */
export function reject(state: DraftState, action: Action, code: ErrorCode, message: string): ReduceResult {
  return {
    state,
    events: [{ type: "draft:rejected", action, code, message }],
  };
}

export function ok(state: DraftState, events: Event[]): ReduceResult {
  return { state, events };
}
