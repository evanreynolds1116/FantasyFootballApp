import type { DraftSettings } from "../settings/types.js";
import type { DraftState, Team, TeamId } from "../model/types.js";
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
