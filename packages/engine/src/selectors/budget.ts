import type { DraftState, TeamId } from "../model/types.js";

export function spentByTeam(state: DraftState, teamId: TeamId): number {
  return state.picks
    .filter((p) => p.teamId === teamId && p.price !== null)
    .reduce((sum, p) => sum + (p.price ?? 0), 0);
}

export function remainingBudget(state: DraftState, teamId: TeamId): number {
  return state.settings.startingBudget - spentByTeam(state, teamId);
}

/** No forced reserve rule: max bid is simply whatever budget remains. */
export function maxBid(state: DraftState, teamId: TeamId): number {
  return remainingBudget(state, teamId);
}

export function auctionSpotsFilled(state: DraftState, teamId: TeamId): number {
  return state.picks.filter((p) => p.teamId === teamId && p.source === "auction").length;
}

export function auctionSpotsRemaining(state: DraftState, teamId: TeamId): number {
  return state.settings.auctionSpots - auctionSpotsFilled(state, teamId);
}

/**
 * How many of the team's `auctionSpots`-many designated slots are filled,
 * whether by winning an auction lot or by a later make-up pick (make-up
 * picks fill the same designated slots via snake order instead of bidding).
 */
export function auctionDesignatedSpotsFilled(state: DraftState, teamId: TeamId): number {
  return state.picks.filter((p) => p.teamId === teamId && (p.source === "auction" || p.source === "makeup")).length;
}

export function auctionDesignatedSpotsRemaining(state: DraftState, teamId: TeamId): number {
  return state.settings.auctionSpots - auctionDesignatedSpotsFilled(state, teamId);
}

/** Broke = remaining budget below the minimum bid, with auction spots still open. */
export function isBroke(state: DraftState, teamId: TeamId): boolean {
  return auctionSpotsRemaining(state, teamId) > 0 && remainingBudget(state, teamId) < state.settings.minBid;
}
