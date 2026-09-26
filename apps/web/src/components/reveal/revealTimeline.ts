// The show's timeline lives in the engine so the server holds the next clock exactly as long as screens play it.
export { DETAILS_AFTER_MS, FLIP_GAP_MS, planReveal, revealDurationMs, SEALED_MS, SUSPENSE_MS, UP_NEXT_MS, type RevealPlan } from "@draft-app/engine";

/** How long the winning price takes to count up. */
export const COUNT_UP_MS = 900;

/** The count-up from the best runner-up (or $0) to the winning price, eased out. */
export function countUpValue(from: number, to: number, elapsedMs: number): number {
  if (elapsedMs >= COUNT_UP_MS) return to;
  const p = Math.max(0, elapsedMs) / COUNT_UP_MS;
  const eased = 1 - (1 - p) ** 3;
  return Math.round(from + (to - from) * eased);
}
