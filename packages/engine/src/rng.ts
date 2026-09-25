import type { TeamId } from "./model/types.js";

/** Picks one element deterministically from ctx.rng(), a float in [0, 1). */
export function pickOne<T>(items: T[], rng: () => number): T {
  const index = Math.floor(rng() * items.length);
  const clamped = Math.min(items.length - 1, Math.max(0, index));
  return items[clamped] as T;
}

export function randomDraw(teamIds: TeamId[], rng: () => number): TeamId {
  return pickOne(teamIds, rng);
}
