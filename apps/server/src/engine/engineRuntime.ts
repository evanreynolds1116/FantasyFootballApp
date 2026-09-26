import { reduce, type Action, type Ctx, type DraftState, type ErrorCode, type Event, type LotState } from "@draft-app/engine";
import { eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { extractBookkeeping } from "../db/engineState.js";
import { persistReduceResult, wasRejected } from "../db/persistReduceResult.js";
import { loadDraftState } from "../db/loadDraftState.js";
import { draft, lot } from "../db/schema.js";
import { createMutex } from "./mutex.js";

export type ApplyActionResult =
  | { rejected: false; events: Event[]; state: DraftState }
  | { rejected: true; code: ErrorCode; message: string };

type ArmedClock =
  | { kind: "lot"; endsAt: number; lotId: string }
  | { kind: "tie"; endsAt: number; lotId: string }
  | { kind: "nomination"; endsAt: number }
  | { kind: "pick"; endsAt: number; teamId: string };

export type RecoveredClock = { draftId: string; kind: ArmedClock["kind"]; newEndsAt: number };

const TERMINAL_LOT_STATES = new Set<LotState>(["awarded", "returnedToPool", "cancelled"]);

function findCurrentLot(state: DraftState) {
  return state.lots.find((l) => !TERMINAL_LOT_STATES.has(l.state));
}

/** Mirrors the engine's own "which clock is live" precedence (see packages/engine/src/rules/pauseResume.ts). */
function determineActiveClock(state: DraftState): ArmedClock | null {
  const current = findCurrentLot(state);
  if (current && (current.state === "open" || current.state === "tieRebid") && current.endsAt !== null) {
    return current.state === "tieRebid"
      ? { kind: "tie", endsAt: current.endsAt, lotId: current.id }
      : { kind: "lot", endsAt: current.endsAt, lotId: current.id };
  }
  if (state.nominationEndsAt !== null) {
    return { kind: "nomination", endsAt: state.nominationEndsAt };
  }
  if (state.snakePickEndsAt !== null && state.snakePickTurnTeamId !== null) {
    return { kind: "pick", endsAt: state.snakePickEndsAt, teamId: state.snakePickTurnTeamId };
  }
  return null;
}

function actionForArmedClock(armed: ArmedClock): Action {
  switch (armed.kind) {
    case "lot":
      return { type: "clock:lotExpired", lotId: armed.lotId };
    case "tie":
      return { type: "clock:tieExpired", lotId: armed.lotId };
    case "nomination":
      return { type: "clock:nominationExpired" };
    case "pick":
      return { type: "clock:pickExpired", teamId: armed.teamId };
  }
}

/**
 * One self-contained runtime per server process/instance: the in-memory
 * active-draft registry, the timer scheduler, and the single applyAction
 * mutation entrypoint, all sharing instance-local state (never a module-
 * level singleton, so two independent server instances — e.g. in a restart
 * test — never see each other's in-memory state).
 */
type Broadcaster = (draftId: string, state: DraftState, events: Event[]) => void;

export function createEngineRuntime(db: Db) {
  const registry = new Map<string, DraftState>();
  const hydrating = new Map<string, Promise<DraftState>>();
  const timers = new Map<string, { timeout: NodeJS.Timeout; armed: ArmedClock }>();
  const runExclusive = createMutex();
  let broadcaster: Broadcaster | null = null;

  /**
   * Socket.IO doesn't exist yet when the runtime is constructed (registering
   * it requires the runtime itself, for intent handlers), so this is wired
   * in by buildServer() right after both exist. Without it, clock-driven
   * actions (fireExpiry, with no WS caller to hand events back to) would
   * mutate/persist state but never reach connected clients.
   */
  function setBroadcaster(fn: Broadcaster): void {
    broadcaster = fn;
  }

  async function getOrHydrate(draftId: string): Promise<DraftState> {
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

  function peekState(draftId: string): DraftState | undefined {
    return registry.get(draftId);
  }

  function setState(draftId: string, state: DraftState): void {
    registry.set(draftId, state);
  }

  function clearTimer(draftId: string): void {
    const entry = timers.get(draftId);
    if (entry) {
      clearTimeout(entry.timeout);
      timers.delete(draftId);
    }
  }

  function armTimer(draftId: string, state: DraftState): void {
    clearTimer(draftId);
    const active = determineActiveClock(state);
    if (!active) return;

    const delayMs = Math.max(0, active.endsAt - Date.now());
    const timeout = setTimeout(() => {
      void fireExpiry(draftId);
    }, delayMs);
    timers.set(draftId, { timeout, armed: active });
  }

  async function fireExpiry(draftId: string): Promise<void> {
    const entry = timers.get(draftId);
    if (!entry) return;
    timers.delete(draftId);

    const action = actionForArmedClock(entry.armed);
    const ctx: Ctx = { now: Date.now(), rng: Math.random };
    try {
      await applyAction(draftId, action, ctx, null);
    } catch (err) {
      // No WS caller to hand a SERVER_ERROR ack to here — this is the
      // clock-driven path, not a client intent — so the failure can only be
      // logged. Left uncaught, it becomes a process-level unhandled
      // rejection instead of a contained, diagnosable failure.
      console.error(`fireExpiry failed for draft ${draftId}`, err);
    }
  }

  async function applyAction(draftId: string, action: Action, ctx: Ctx, actorUserId: string | null): Promise<ApplyActionResult> {
    return runExclusive(draftId, async () => {
      const state = await getOrHydrate(draftId);
      const result = reduce(state, action, ctx);

      if (wasRejected(result)) {
        const rejection = result.events[0];
        if (rejection && rejection.type === "draft:rejected") {
          return { rejected: true, code: rejection.code, message: rejection.message };
        }
      }

      await persistReduceResult(db, draftId, actorUserId, action, state, result);

      registry.set(draftId, result.state);
      armTimer(draftId, result.state);
      broadcaster?.(draftId, result.state, result.events);

      return { rejected: false, events: result.events, state: result.state };
    });
  }

  /**
   * Server-level policy (not engine logic — the engine has no concept of
   * "downtime"): if a draft's live clock already passed while the server
   * was down, patch a fresh endsAt (extended by the tie re-bid clock, per
   * SPEC.md's edge-case row) directly into state before re-arming, and
   * report it so the caller can broadcast draft:recovered.
   */
  async function recoverIfDowntime(draftId: string, state: DraftState): Promise<{ state: DraftState; recovered: RecoveredClock | null }> {
    const active = determineActiveClock(state);
    if (!active || active.endsAt > Date.now()) {
      return { state, recovered: null };
    }

    const settings = state.settings;
    const extensionSec = settings.tieClockSec !== "off" ? settings.tieClockSec : settings.bidClockSec !== "off" ? settings.bidClockSec : 30;
    const newEndsAt = Date.now() + extensionSec * 1000;

    let nextState: DraftState;
    if (active.kind === "lot" || active.kind === "tie") {
      nextState = { ...state, lots: state.lots.map((l) => (l.id === active.lotId ? { ...l, endsAt: newEndsAt } : l)) };
      await db.update(lot).set({ endsAt: new Date(newEndsAt) }).where(eq(lot.id, active.lotId));
    } else if (active.kind === "nomination") {
      nextState = { ...state, nominationEndsAt: newEndsAt };
      await db.update(draft).set({ engineState: extractBookkeeping(nextState) }).where(eq(draft.id, draftId));
    } else {
      nextState = { ...state, snakePickEndsAt: newEndsAt };
      await db.update(draft).set({ engineState: extractBookkeeping(nextState) }).where(eq(draft.id, draftId));
    }

    setState(draftId, nextState);
    return { state: nextState, recovered: { draftId, kind: active.kind, newEndsAt } };
  }

  /** Runs once at server boot: re-hydrates every non-terminal draft, applies downtime recovery if needed, re-arms every timer. */
  async function bootstrapScheduler(): Promise<RecoveredClock[]> {
    const rows = await db.select({ id: draft.id }).from(draft).where(notInArray(draft.phase, ["setup", "complete"]));

    const recovered: RecoveredClock[] = [];
    for (const { id } of rows) {
      const loaded = await getOrHydrate(id);
      const { state, recovered: recoveredClock } = await recoverIfDowntime(id, loaded);
      if (recoveredClock) recovered.push(recoveredClock);
      armTimer(id, state);
    }
    return recovered;
  }

  return {
    db,
    getOrHydrate,
    peekState,
    setState,
    applyAction,
    armTimer,
    clearTimer,
    bootstrapScheduler,
    setBroadcaster,
  };
}

export type EngineRuntime = ReturnType<typeof createEngineRuntime>;
