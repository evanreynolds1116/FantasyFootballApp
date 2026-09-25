import { reduce, type Action, type Ctx, type DraftState, type ErrorCode, type Event } from "@draft-app/engine";
import type { Db } from "../db/client.js";
import { loadDraftState } from "../db/loadDraftState.js";
import { persistReduceResult, wasRejected } from "../db/persistReduceResult.js";
import { armTimer } from "../scheduler/timerScheduler.js";
import { runExclusive } from "./mutex.js";

const registry = new Map<string, DraftState>();
const hydrating = new Map<string, Promise<DraftState>>();

/** Returns the in-memory state for a draft (steady-state, no DB round-trip), hydrating from Postgres on first touch. */
export async function getOrHydrate(db: Db, draftId: string): Promise<DraftState> {
  const cached = registry.get(draftId);
  if (cached) return cached;

  const inFlight = hydrating.get(draftId);
  if (inFlight) return inFlight;

  const promise = loadDraftState(db, draftId).then((state) => {
    registry.set(draftId, state);
    hydrating.delete(draftId);
    return state;
  });
  hydrating.set(draftId, promise);
  return promise;
}

/** The current in-memory state without hydrating — used by the scheduler, which only ever acts on already-loaded drafts. */
export function peekState(draftId: string): DraftState | undefined {
  return registry.get(draftId);
}

/** Directly installs a state into the registry (used by the scheduler's downtime-recovery patch and by bootstrap). */
export function setState(draftId: string, state: DraftState): void {
  registry.set(draftId, state);
}

export type ApplyActionResult =
  | { rejected: false; events: Event[]; state: DraftState }
  | { rejected: true; code: ErrorCode; message: string };

/**
 * The single mutation entrypoint: hydrate -> reduce -> persist -> update
 * registry -> re-arm timer. Used identically by WS intent handlers and the
 * timer scheduler's fireExpiry, serialized per draftId so two near-
 * simultaneous actions on the same draft can't race on a stale state read.
 */
export async function applyAction(
  db: Db,
  draftId: string,
  action: Action,
  ctx: Ctx,
  actorUserId: string | null,
): Promise<ApplyActionResult> {
  return runExclusive(draftId, async () => {
    const state = await getOrHydrate(db, draftId);
    const result = reduce(state, action, ctx);

    if (wasRejected(result)) {
      const rejection = result.events[0];
      if (rejection && rejection.type === "draft:rejected") {
        return { rejected: true, code: rejection.code, message: rejection.message };
      }
    }

    await persistReduceResult(db, draftId, actorUserId, action, state, result);

    registry.set(draftId, result.state);
    armTimer(db, draftId, result.state);

    return { rejected: false, events: result.events, state: result.state };
  });
}
