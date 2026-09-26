import type { DraftState, TeamId } from "../model/types.js";
import { auctionDesignatedSpotsRemaining } from "./budget.js";
import { orderForRound, teamsByDraftNumber } from "./order.js";

function totalSnakeRounds(state: DraftState): number {
  return Math.max(0, state.settings.rosterSize - state.settings.auctionSpots);
}

/** Snake turns this team still has coming (including one it's on the clock for now, or a deferred catch-up). */
export function futureSnakeTurns(state: DraftState, teamId: TeamId): number {
  const total = totalSnakeRounds(state);
  if (state.phase === "setup" || state.phase === "auction") return total;
  if (state.phase !== "snake") return 0;
  const order = orderForRound(teamsByDraftNumber(state.teams), state.snakeRound, 1);
  const stillThisRound = order.indexOf(teamId) >= state.snakeRoundTurnsTaken || state.deferredPicks.some((d) => d.teamId === teamId && d.round === state.snakeRound);
  return total - state.snakeRound + (stillThisRound ? 1 : 0);
}

/**
 * Roster spots the team has that no future turn will fill — where a
 * commissioner can put a player without ever pushing a roster past its
 * size. Auction spots: designated auction spots not yet won or made up (the
 * auction or make-up round may still fill these too). Snake spots: snake
 * rounds not covered by a pick already made or a turn still to come, so
 * normally 0 — it opens when the commissioner removes a snake pick.
 */
export function openRosterSlots(state: DraftState, teamId: TeamId): { auction: number; snake: number } {
  const snakePicks = state.picks.filter((p) => p.teamId === teamId && (p.source === "snake" || p.source === "auto")).length;
  return {
    auction: Math.max(0, auctionDesignatedSpotsRemaining(state, teamId)),
    snake: Math.max(0, totalSnakeRounds(state) - snakePicks - futureSnakeTurns(state, teamId)),
  };
}
