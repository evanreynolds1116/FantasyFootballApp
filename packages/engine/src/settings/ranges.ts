/**
 * Allowed clock lengths in seconds, from SPEC.md's league settings table
 * ("off, 10–300 s" etc.). "off" is always allowed in addition to the range.
 * Shared so the server's validation and the commissioner console's steppers
 * never disagree.
 */
export const CLOCK_RANGES_SEC = {
  nomination: { min: 10, max: 300 },
  bid: { min: 10, max: 600 },
  tie: { min: 10, max: 300 },
  pick: { min: 10, max: 600 },
} as const;

export type ClockName = keyof typeof CLOCK_RANGES_SEC;
