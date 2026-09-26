import type { DraftSettings } from "../settings/types.js";
import type { DraftState, Team, TeamId } from "../model/types.js";
import { auctionDesignatedSpotsRemaining, auctionSpotsFilled } from "./budget.js";
import { canNominate } from "./eligibility.js";

export function teamsByDraftNumber(teams: Team[]): TeamId[] {
  return [...teams].sort((a, b) => a.draftNumber - b.draftNumber).map((t) => t.id);
}

/**
 * Pure snake-order generator: given a base (ascending) team-id list, a
 * 1-indexed round counted from the start of whichever phase is snaking, and
 * the direction that round 1 of that phase runs in, returns the order for
 * that round. Direction flips every round. This same generator produces the
 * turn-around behavior (the last team of one round and the first team of the
 * next both being the same team) purely from alternating per-round direction
 * — no special-casing needed.
 */
export function directionForRound(roundIndexWithinPhase: number, startDirection: 1 | -1 = 1): 1 | -1 {
  const roundIsOffsetEven = (roundIndexWithinPhase - 1) % 2 === 0;
  return roundIsOffsetEven ? startDirection : startDirection === 1 ? -1 : 1;
}

export function orderForRound(
  teamIds: TeamId[],
  roundIndexWithinPhase: number,
  startDirection: 1 | -1 = 1,
): TeamId[] {
  const direction = directionForRound(roundIndexWithinPhase, startDirection);
  return direction === 1 ? [...teamIds] : [...teamIds].reverse();
}

/** Auction nomination order for a round: honors the snake/fixed setting. Always starts ascending. */
export function nominationOrderForRound(
  settings: DraftSettings,
  teamIds: TeamId[],
  round: number,
): TeamId[] {
  if (settings.nominationOrder === "fixed") return [...teamIds];
  return orderForRound(teamIds, round, 1);
}

/**
 * The full nomination order for `round`, filtered to teams currently
 * eligible to nominate. Eligibility can't change mid-nomination-collection
 * (no picks are made until the round's bidding sub-phase begins), so this
 * can be freely recomputed from current state at any point during that
 * sub-phase and always agree with what it was at round start.
 */
export function eligibleNominationOrderForRound(state: DraftState, round: number): TeamId[] {
  const base = teamsByDraftNumber(state.teams);
  const eligible = base.filter((id) => canNominate(state, id));
  return nominationOrderForRound(state.settings, eligible, round);
}

/**
 * Make-up turn order (SPEC phase 2 step 3: broke teams, in snake order among
 * just those teams, continuing the direction the snake ended).
 *
 * For the current make-up round the order is fixed at round start: teams
 * that still owe a pick plus teams that already made their pick this round.
 * Recomputing from "still owes" alone would shrink the list mid-round when a
 * team fills its last spot, and the turn counter would then skip whoever was
 * next. For the following round it projects who will still owe a pick once
 * this round's remaining turns are taken.
 */
export function makeupOrderForRound(state: DraftState, round: number = state.makeupRound): TeamId[] {
  const broke = teamsByDraftNumber(state.teams).filter((id) => auctionSpotsFilled(state, id) < state.settings.auctionSpots);
  const pickedInRound = (id: TeamId, r: number) => state.picks.some((p) => p.teamId === id && p.source === "makeup" && p.round === r);
  let participants: TeamId[];
  if (round === state.makeupRound) {
    participants = broke.filter((id) => auctionDesignatedSpotsRemaining(state, id) > 0 || pickedInRound(id, round));
  } else {
    const current = makeupOrderForRound(state, state.makeupRound);
    participants = broke.filter((id) => {
      const stillToPickThisRound = current.includes(id) && !pickedInRound(id, state.makeupRound) ? 1 : 0;
      return auctionDesignatedSpotsRemaining(state, id) - stillToPickThisRound > 0;
    });
  }
  return orderForRound(participants, round, state.snakeDirection);
}
