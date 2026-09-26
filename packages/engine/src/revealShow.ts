/**
 * The reveal show's timeline (UI.md §3), shared by the server — which holds
 * whatever comes next until the show is over — and every screen that plays
 * it, so the two can never drift apart. All times are ms from the moment
 * bids were revealed. Pure: no clock is read here.
 */

/** How long the sealed cards shake while the drumroll builds. */
export const SEALED_MS = 2400;
/** The gap between runner-up flips, shrunk when many bids are shown. */
export const FLIP_GAP_MS = 1500;
/** Cap on all runner-up flips together, so "all bids" doesn't drag on. */
const ALL_FLIPS_MAX_MS = 5000;
/** "And the winner is…" */
export const SUSPENSE_MS = 1000;
/** From the winner's card flipping to the budget/spots/"Up next" details appearing. */
export const DETAILS_AFTER_MS = 1400;
/** How long "Up next · clock starts in" counts down once the details are up. */
export const UP_NEXT_MS = 10_000;
/** With no bids at all there's nothing to build up to. */
const NO_BIDS_MS = 1500;

type ShownBid = { teamId: string; amount: number };

export type RevealPlan<B extends ShownBid = ShownBid> = {
  /** Bids shown before the top, lowest first, each with the moment it flips. */
  flips: { bid: B; at: number }[];
  /** The top bid(s): one winner, or every team tied at the top. */
  top: B[];
  tie: boolean;
  /** When the top card(s) flip — the big moment. */
  topAt: number;
  /** When "And the winner is…" shows (null when there's nothing to build up to). */
  suspenseAt: number | null;
  /** When the winner's budget/spots and "Up next" appear. */
  detailsAt: number;
  /** The whole show: the details, then a full UP_NEXT_MS countdown. The server holds the next clock this long. */
  durationMs: number;
  /** The drumroll's tick times, speeding up across the sealed stage. */
  ticks: number[];
};

/**
 * Plans the show for the bids a reveal showed: sealed cards and a drumroll,
 * runner-ups flipping lowest first, a beat of suspense, then the winner (or
 * the tie), then the details and a 10-second "Up next" countdown.
 */
export function planReveal<B extends ShownBid>(bids: B[], winnerTeamId: string | null): RevealPlan<B> {
  const sorted = [...bids].sort((a, b) => b.amount - a.amount);
  if (sorted.length === 0) {
    return { flips: [], top: [], tie: false, topAt: NO_BIDS_MS, suspenseAt: null, detailsAt: NO_BIDS_MS, durationMs: NO_BIDS_MS + UP_NEXT_MS, ticks: drumroll(NO_BIDS_MS) };
  }

  const topAmount = sorted[0]!.amount;
  const tie = winnerTeamId === null;
  const top = tie ? sorted.filter((b) => b.amount === topAmount) : sorted.filter((b) => b.teamId === winnerTeamId);
  const rest = sorted.filter((b) => !top.includes(b)).reverse();

  const gap = rest.length > 0 ? Math.min(FLIP_GAP_MS, ALL_FLIPS_MAX_MS / rest.length) : 0;
  const flips = rest.map((bid, i) => ({ bid, at: Math.round(SEALED_MS + i * gap) }));
  const suspenseAt = Math.round(SEALED_MS + rest.length * gap);
  const topAt = suspenseAt + SUSPENSE_MS;
  const detailsAt = topAt + DETAILS_AFTER_MS;
  return { flips, top, tie, topAt, suspenseAt, detailsAt, durationMs: detailsAt + UP_NEXT_MS, ticks: drumroll(SEALED_MS) };
}

/** How long a reveal of these bids plays — and so how long the server holds the next clock. */
export function revealDurationMs(bids: ShownBid[], winnerTeamId: string | null): number {
  return planReveal(bids, winnerTeamId).durationMs;
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
