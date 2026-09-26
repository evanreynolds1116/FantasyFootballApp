import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState } from "../model/types.js";
import { currentLot } from "../selectors/lots.js";
import type { Event } from "../events/types.js";
import { ok, type ReduceResult } from "./result.js";

/** Freezes whichever single clock is currently running, storing its remainingMs. Returns the remaining ms captured, if any. */
export function freezeCurrentClock(state: DraftState, ctx: Ctx): { state: DraftState; remainingMs: number | null } {
  // Pausing during a "back in" countdown: the unused part of the countdown isn't clock time, so it isn't banked.
  // Likewise for a reveal still playing: the clock hadn't started yet.
  const from = Math.max(ctx.now, state.resumeHoldUntil ?? 0, state.revealHoldUntil ?? 0);
  const cleared = { ...state, resumeHoldUntil: null, revealHoldUntil: null };
  const lot = currentLot(state);
  if (lot && (lot.state === "open" || lot.state === "tieRebid") && lot.endsAt !== null) {
    const remainingMs = lot.endsAt - from;
    const updatedLot = { ...lot, endsAt: null, remainingMs };
    return { state: { ...cleared, lots: state.lots.map((l) => (l.id === lot.id ? updatedLot : l)) }, remainingMs };
  }
  if (state.nominationEndsAt !== null) {
    const remainingMs = state.nominationEndsAt - from;
    return { state: { ...cleared, nominationEndsAt: null, nominationRemainingMs: remainingMs }, remainingMs };
  }
  if (state.snakePickEndsAt !== null) {
    const remainingMs = state.snakePickEndsAt - from;
    return { state: { ...cleared, snakePickEndsAt: null, snakePickRemainingMs: remainingMs }, remainingMs };
  }
  return { state: cleared, remainingMs: null };
}

/** SPEC: Resume is followed by a 10-second "back in" countdown before the clock picks up. */
export const BACK_IN_MS = 10_000;

/** Restores whichever clock was frozen, computing a fresh endsAt from `start` (now + the back-in countdown) + remainingMs. Returns the restored endsAt, if any. */
function unfreezeCurrentClock(state: DraftState, start: number): { state: DraftState; endsAt: number | null } {
  const lot = currentLot(state);
  if (lot && (lot.state === "open" || lot.state === "tieRebid") && lot.remainingMs !== null) {
    const endsAt = start + lot.remainingMs;
    const updatedLot = { ...lot, endsAt, remainingMs: null };
    return { state: { ...state, lots: state.lots.map((l) => (l.id === lot.id ? updatedLot : l)) }, endsAt };
  }
  if (state.nominationRemainingMs !== null) {
    const endsAt = start + state.nominationRemainingMs;
    return { state: { ...state, nominationEndsAt: endsAt, nominationRemainingMs: null }, endsAt };
  }
  if (state.snakePickRemainingMs !== null) {
    const endsAt = start + state.snakePickRemainingMs;
    return { state: { ...state, snakePickEndsAt: endsAt, snakePickRemainingMs: null }, endsAt };
  }
  return { state, endsAt: null };
}

export function applyAdminPause(state: DraftState, _action: Extract<Action, { type: "admin:pause" }>, ctx: Ctx): ReduceResult {
  if (state.paused) return ok(state, []);
  const frozen = freezeCurrentClock(state, ctx);
  const nextState = bumpVersion({ ...frozen.state, paused: true });
  const events: Event[] = [{ type: "draft:paused", remainingMs: frozen.remainingMs, breakEndsAt: nextState.breakEndsAt }];
  return { state: nextState, events };
}

export function applyAdminResume(state: DraftState, _action: Extract<Action, { type: "admin:resume" }>, ctx: Ctx): ReduceResult {
  if (!state.paused) return ok(state, []);
  // Every resume, not just after a timed break: nobody gets caught away from their phone.
  const resumeHoldUntil = ctx.now + BACK_IN_MS;
  const restored = unfreezeCurrentClock(state, resumeHoldUntil);
  const nextState = bumpVersion({ ...restored.state, paused: false, breakEndsAt: null, resumeHoldUntil });
  const events: Event[] = [{ type: "draft:resumed", endsAt: restored.endsAt }];
  return { state: nextState, events };
}

export function applyAdminBreak(state: DraftState, action: Extract<Action, { type: "admin:break" }>, ctx: Ctx): ReduceResult {
  const frozen = state.paused ? { state, remainingMs: null } : freezeCurrentClock(state, ctx);
  const breakEndsAt = ctx.now + action.minutes * 60_000;
  const nextState = bumpVersion({ ...frozen.state, paused: true, breakEndsAt });
  const events: Event[] = [{ type: "draft:paused", remainingMs: frozen.remainingMs, breakEndsAt }];
  return { state: nextState, events };
}
