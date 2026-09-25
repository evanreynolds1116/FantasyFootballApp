import type { DraftState, PlayerId, TeamId } from "../model/types.js";
import { auctionSpotsRemaining, isBroke, remainingBudget } from "./budget.js";
import { wouldExceedPositionMax } from "./roster.js";

/** Has an open auction spot and can still afford the minimum bid. */
export function canNominate(state: DraftState, teamId: TeamId): boolean {
  return auctionSpotsRemaining(state, teamId) > 0 && remainingBudget(state, teamId) >= state.settings.minBid;
}

export function isFullOrBroke(state: DraftState, teamId: TeamId): boolean {
  return auctionSpotsRemaining(state, teamId) === 0 || isBroke(state, teamId);
}

/** True once no team can nominate or bid any further — the auction is over. */
export function allTeamsFullOrBroke(state: DraftState): boolean {
  return state.teams.every((t) => isFullOrBroke(state, t.id));
}

function playerPosition(state: DraftState, playerId: PlayerId): string | undefined {
  return state.players.find((p) => p.id === playerId)?.position;
}

/** Eligible to bid on a lot for this player: open spot, can afford min bid, not maxed on the position. */
export function canBidOnPlayer(state: DraftState, teamId: TeamId, playerId: PlayerId): boolean {
  if (auctionSpotsRemaining(state, teamId) <= 0) return false;
  if (remainingBudget(state, teamId) < state.settings.minBid) return false;
  const position = playerPosition(state, playerId);
  if (position && wouldExceedPositionMax(state, teamId, position)) return false;
  return true;
}

export function eligibleTeamIdsForPlayer(state: DraftState, playerId: PlayerId): TeamId[] {
  return state.teams.filter((t) => canBidOnPlayer(state, t.id, playerId)).map((t) => t.id);
}
