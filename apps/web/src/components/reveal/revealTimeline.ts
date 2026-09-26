import type { RevealedBid } from "../../lib/contracts";

/** How long the sealed cards shake while the drumroll builds. */
export const SEALED_MS = 2400;
/** The gap between runner-up flips, shrunk when many bids are shown so the whole show fits the reveal. */
const FLIP_GAP_MS = 800;
const ALL_FLIPS_MAX_MS = 3200;
/** "And the winner is…" */
const SUSPENSE_MS = 1000;
/** From the winner's card flipping to the budget/spots details appearing. */
const DETAILS_AFTER_MS = 1400;
/** How long the winning price takes to count up. */
export const COUNT_UP_MS = 900;
/** With no bids at all there's nothing to build up to. */
const NO_BIDS_MS = 1500;

export type RevealPlan = {
  /** Bids shown before the top, lowest first, each with the moment it flips. */
  flips: { bid: RevealedBid; at: number }[];
  /** The top bid(s): one winner, or every team tied at the top. */
  top: RevealedBid[];
  tie: boolean;
  /** When the top card(s) flip — the big moment. */
  topAt: number;
  /** When "And the winner is…" shows (null when there's nothing to build up to). */
  suspenseAt: number | null;
  detailsAt: number;
  /** The drumroll's tick times, speeding up across the sealed stage. */
  ticks: number[];
};

/**
 * The reveal as a timeline in ms from the moment bids were revealed, so every
 * screen plays the same show from the same message: sealed cards and a
 * drumroll, runner-ups flipping lowest first, a beat of suspense, then the
 * winner (or the tie). Only bids the server revealed ever appear.
 */
export function planReveal(bids: RevealedBid[], winnerTeamId: string | null): RevealPlan {
  const sorted = [...bids].sort((a, b) => b.amount - a.amount);
  if (sorted.length === 0) {
    return { flips: [], top: [], tie: false, topAt: NO_BIDS_MS, suspenseAt: null, detailsAt: NO_BIDS_MS, ticks: drumroll(NO_BIDS_MS) };
  }

  const topAmount = sorted[0]!.amount;
  const tie = winnerTeamId === null;
  const top = tie ? sorted.filter((b) => b.amount === topAmount) : sorted.filter((b) => b.teamId === winnerTeamId);
  const rest = sorted.filter((b) => !top.includes(b)).reverse();

  const gap = rest.length > 0 ? Math.min(FLIP_GAP_MS, ALL_FLIPS_MAX_MS / rest.length) : 0;
  const flips = rest.map((bid, i) => ({ bid, at: Math.round(SEALED_MS + i * gap) }));
  const suspenseAt = Math.round(SEALED_MS + rest.length * gap);
  const topAt = suspenseAt + SUSPENSE_MS;
  return { flips, top, tie, topAt, suspenseAt, detailsAt: topAt + DETAILS_AFTER_MS, ticks: drumroll(SEALED_MS) };
}

/** Ticks that start slow and speed up toward the end of `span`. */
function drumroll(span: number): number[] {
  const ticks: number[] = [];
  let t = 0;
  let interval = 420;
  while (t < span - 60) {
    ticks.push(Math.round(t));
    t += interval;
    interval = Math.max(90, interval * 0.8);
  }
  return ticks;
}

/** The count-up from the best runner-up (or $0) to the winning price, eased out. */
export function countUpValue(from: number, to: number, elapsedMs: number): number {
  if (elapsedMs >= COUNT_UP_MS) return to;
  const p = Math.max(0, elapsedMs) / COUNT_UP_MS;
  const eased = 1 - (1 - p) ** 3;
  return Math.round(from + (to - from) * eased);
}
