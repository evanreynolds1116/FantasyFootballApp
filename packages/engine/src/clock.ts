import type { ClockSetting } from "./settings/types.js";

/**
 * Injected clock + randomness. The engine never calls Date.now() or
 * Math.random() directly — every rule that needs "now" or a random draw
 * takes it from here (CLAUDE.md non-negotiable).
 */
export type Ctx = {
  /** Absolute ms epoch timestamp, supplied by the caller. */
  now: number;
  /** Returns a float in [0, 1), supplied by the caller. */
  rng: () => number;
};

export const EARLY_CLOSE_LAST_CHANCE_MS = 3000;

/** How long every screen shows a reveal before play moves on (SPEC's "10 s reveal"). */
export const REVEAL_HOLD_MS = 10_000;

/** The ctx for starting whatever comes after a reveal: its clock begins once the reveal has played. */
export function afterReveal(ctx: Ctx): Ctx {
  return { ...ctx, now: ctx.now + REVEAL_HOLD_MS };
}

/** endsAt for a clock starting now, or null if the clock is off. */
export function endsAtFor(now: number, clockSec: ClockSetting): number | null {
  return clockSec === "off" ? null : now + clockSec * 1000;
}
