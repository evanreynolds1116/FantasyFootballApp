import type { DraftState, PlayerId, TeamId } from "../model/types.js";
import { isPlayerAvailable } from "./lots.js";

/** The team's queue, best first, minus anyone already taken, in flight or unavailable. */
export function availableQueue(state: DraftState, teamId: TeamId): PlayerId[] {
  return (state.queues[teamId] ?? []).filter((id) => isPlayerAvailable(state, id));
}

/** The first available queued player who also passes `fits` (e.g. roster limits), or undefined. */
export function firstQueued(state: DraftState, teamId: TeamId, fits: (playerId: PlayerId) => boolean = () => true): PlayerId | undefined {
  return availableQueue(state, teamId).find(fits);
}
