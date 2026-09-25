import type { DraftState, TeamId } from "../model/types.js";
import type { PositionGroup } from "../settings/types.js";

export function picksForTeam(state: DraftState, teamId: TeamId) {
  return state.picks.filter((p) => p.teamId === teamId);
}

export function rosterCount(state: DraftState, teamId: TeamId): number {
  return picksForTeam(state, teamId).length;
}

export function rosterSpotsRemaining(state: DraftState, teamId: TeamId): number {
  return state.settings.rosterSize - rosterCount(state, teamId);
}

export function positionGroupFor(
  groups: PositionGroup[] | null,
  position: string,
): PositionGroup | undefined {
  if (!groups) return undefined;
  return groups.find((g) => g.positions.includes(position));
}

/** Count of a team's drafted players falling in the given position group. */
export function positionGroupCount(state: DraftState, teamId: TeamId, group: PositionGroup): number {
  const playerById = new Map(state.players.map((p) => [p.id, p]));
  return picksForTeam(state, teamId).filter((pick) => {
    const player = playerById.get(pick.playerId);
    return player !== undefined && group.positions.includes(player.position);
  }).length;
}

/** True if drafting another player at `position` would push the team past that group's max. */
export function wouldExceedPositionMax(state: DraftState, teamId: TeamId, position: string): boolean {
  const group = positionGroupFor(state.settings.positionGroups, position);
  if (!group) return false;
  return positionGroupCount(state, teamId, group) >= group.max;
}

/**
 * True if it's still possible for the team to meet every position group's
 * minimum within its remaining roster spots, optionally simulating one more
 * pick at `hypotheticalPosition` first.
 */
export function remainingMinimumsReachable(
  state: DraftState,
  teamId: TeamId,
  hypotheticalPosition?: string,
): boolean {
  const groups = state.settings.positionGroups;
  if (!groups) return true;

  const spotsRemainingAfterPick = rosterSpotsRemaining(state, teamId) - (hypotheticalPosition ? 1 : 0);

  const totalDeficit = groups.reduce((sum, group) => {
    let count = positionGroupCount(state, teamId, group);
    if (hypotheticalPosition && group.positions.includes(hypotheticalPosition)) {
      count += 1;
    }
    return sum + Math.max(0, group.min - count);
  }, 0);

  return totalDeficit <= spotsRemainingAfterPick;
}

/** Position groups still below their minimum for this team. */
export function groupsBelowMinimum(state: DraftState, teamId: TeamId): PositionGroup[] {
  const groups = state.settings.positionGroups;
  if (!groups) return [];
  return groups.filter((group) => positionGroupCount(state, teamId, group) < group.min);
}
