import type { Action, Ctx, DraftState } from "@draft-app/engine";
import { eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { extractBookkeeping } from "../db/engineState.js";
import { draft, lot } from "../db/schema.js";
import { applyAction, getOrHydrate, setState } from "../engine/activeDraftRegistry.js";

type ArmedClock =
  | { kind: "lot"; endsAt: number; lotId: string }
  | { kind: "tie"; endsAt: number; lotId: string }
  | { kind: "nomination"; endsAt: number }
  | { kind: "pick"; endsAt: number; teamId: string };

export type RecoveredClock = { draftId: string; kind: ArmedClock["kind"]; newEndsAt: number };

const timers = new Map<string, { timeout: NodeJS.Timeout; armed: ArmedClock }>();

const TERMINAL_LOT_STATES = new Set(["awarded", "returnedToPool", "cancelled"]);

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

export function clearTimer(draftId: string): void {
  const entry = timers.get(draftId);
  if (entry) {
    clearTimeout(entry.timeout);
    timers.delete(draftId);
  }
}

/** Clears and recomputes a draft's timer from scratch off the current state — safe to call after every action, regardless of what changed. */
export function armTimer(db: Db, draftId: string, state: DraftState): void {
  clearTimer(draftId);
  const active = determineActiveClock(state);
  if (!active) return;

  const delayMs = Math.max(0, active.endsAt - Date.now());
  const timeout = setTimeout(() => {
    void fireExpiry(db, draftId);
  }, delayMs);
  timers.set(draftId, { timeout, armed: active });
}

async function fireExpiry(db: Db, draftId: string): Promise<void> {
  const entry = timers.get(draftId);
  if (!entry) return;
  timers.delete(draftId);

  const action = actionForArmedClock(entry.armed);
  const ctx: Ctx = { now: Date.now(), rng: Math.random };
  await applyAction(db, draftId, action, ctx, null);
}

/**
 * Server-level policy (not engine logic — the engine has no concept of
 * "downtime"): if a draft's live clock already passed while the server was
 * down, patch a fresh endsAt (extended by the tie re-bid clock, per SPEC.md's
 * edge-case row) directly into state before re-arming, and report it so the
 * caller can broadcast draft:recovered.
 */
async function recoverIfDowntime(db: Db, draftId: string, state: DraftState): Promise<{ state: DraftState; recovered: RecoveredClock | null }> {
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
export async function bootstrapScheduler(db: Db): Promise<RecoveredClock[]> {
  const rows = await db.select({ id: draft.id }).from(draft).where(notInArray(draft.phase, ["setup", "complete"]));

  const recovered: RecoveredClock[] = [];
  for (const { id } of rows) {
    const loaded = await getOrHydrate(db, id);
    const { state, recovered: recoveredClock } = await recoverIfDowntime(db, id, loaded);
    if (recoveredClock) recovered.push(recoveredClock);
    armTimer(db, id, state);
  }
  return recovered;
}
