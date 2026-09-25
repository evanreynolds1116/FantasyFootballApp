import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { endsAtFor } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState } from "../model/types.js";
import { auctionSpotsFilled } from "../selectors/budget.js";
import { availablePlayerIds, isPlayerAvailable } from "../selectors/lots.js";
import { directionForRound, orderForRound, teamsByDraftNumber } from "../selectors/order.js";
import { remainingMinimumsReachable, wouldExceedPositionMax } from "../selectors/roster.js";
import type { Event } from "../events/types.js";
import { awardNonAuctionPick } from "./award.js";
import { beginMakeup } from "./makeup.js";
import { ok, reject, type ReduceResult } from "./result.js";

export function totalSnakeRounds(state: DraftState): number {
  return state.settings.rosterSize - state.settings.auctionSpots;
}

function emitPickTurn(state: DraftState, teamId: string, ctx: Ctx): { state: DraftState; events: Event[] } {
  const endsAt = endsAtFor(ctx.now, state.settings.pickClockSec);
  const nextState = bumpVersion({ ...state, snakePickTurnTeamId: teamId, snakePickEndsAt: endsAt, snakePickRemainingMs: null });
  return { state: nextState, events: [{ type: "pick:turn", teamId, pickNo: state.picks.length + 1, endsAt }] };
}

export function beginSnake(state: DraftState, ctx: Ctx): ReduceResult {
  if (totalSnakeRounds(state) <= 0) {
    return transitionAfterRegularSnake({ ...state, phase: "snake" }, ctx);
  }
  const teams = teamsByDraftNumber(state.teams);
  const round = 1;
  const order = orderForRound(teams, round, 1);
  const base: DraftState = {
    ...state,
    phase: "snake",
    snakeRound: round,
    snakeDirection: directionForRound(round, 1),
    snakeRoundTurnsTaken: 0,
  };
  return emitPickTurn(base, order[0] as string, ctx);
}

function transitionAfterRegularSnake(state: DraftState, ctx: Ctx): ReduceResult {
  const anyBroke = state.teams.some((t) => auctionSpotsFilled(state, t.id) < state.settings.auctionSpots);
  if (state.settings.brokeTeamsFillAtEnd && anyBroke) {
    return beginMakeup(state, ctx);
  }
  const nextState = bumpVersion({
    ...state,
    phase: "complete",
    snakePickTurnTeamId: null,
    snakePickEndsAt: null,
  });
  return { state: nextState, events: [{ type: "draft:phase", phase: "complete" }] };
}

/** Advances to the next snake turn: next team in the round, a deferred catch-up, the next round, or the phase transition. */
function advanceSnakeTurn(state: DraftState, ctx: Ctx): ReduceResult {
  const teams = teamsByDraftNumber(state.teams);
  const n = teams.length;

  if (state.snakeRoundTurnsTaken < n) {
    const order = orderForRound(teams, state.snakeRound, 1);
    return emitPickTurn(state, order[state.snakeRoundTurnsTaken] as string, ctx);
  }

  const deferredIdx = state.deferredPicks.findIndex((d) => d.round === state.snakeRound);
  if (deferredIdx !== -1) {
    const entry = state.deferredPicks[deferredIdx]!;
    const remaining = [...state.deferredPicks.slice(0, deferredIdx), ...state.deferredPicks.slice(deferredIdx + 1)];
    return emitPickTurn({ ...state, deferredPicks: remaining }, entry.teamId, ctx);
  }

  if (state.snakeRound < totalSnakeRounds(state)) {
    const nextRound = state.snakeRound + 1;
    const nextState: DraftState = {
      ...state,
      snakeRound: nextRound,
      snakeDirection: directionForRound(nextRound, 1),
      snakeRoundTurnsTaken: 0,
    };
    return advanceSnakeTurn(nextState, ctx);
  }

  return transitionAfterRegularSnake(state, ctx);
}

function isValidSnakeCandidate(state: DraftState, teamId: string, playerId: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  if (wouldExceedPositionMax(state, teamId, player.position)) return false;
  return remainingMinimumsReachable(state, teamId, player.position);
}

export function applyPickMake(state: DraftState, action: Extract<Action, { type: "pick:make" }>, ctx: Ctx): ReduceResult {
  if (state.phase !== "snake") return reject(state, action, "INVALID_PHASE", "The snake phase is not active.");
  if (action.teamId !== state.snakePickTurnTeamId) {
    return reject(state, action, "NOT_YOUR_TURN", "It is not this team's turn to pick.");
  }
  if (!isPlayerAvailable(state, action.playerId)) {
    return reject(state, action, "PLAYER_TAKEN", "This player is not available.");
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (player && wouldExceedPositionMax(state, action.teamId, player.position)) {
    return reject(state, action, "POSITION_LIMIT", "This position is already at its maximum.");
  }
  if (player && !remainingMinimumsReachable(state, action.teamId, player.position)) {
    return reject(state, action, "POSITION_LIMIT", "This pick would make a remaining position minimum unreachable.");
  }

  const wasNormalTurn = state.snakeRoundTurnsTaken < teamsByDraftNumber(state.teams).length;
  const awarded = awardNonAuctionPick(state, { teamId: action.teamId, playerId: action.playerId, source: "snake", round: state.snakeRound }, ctx);
  const withTurnCount: DraftState = {
    ...awarded.state,
    snakeRoundTurnsTaken: wasNormalTurn ? state.snakeRoundTurnsTaken + 1 : state.snakeRoundTurnsTaken,
  };
  const advanced = advanceSnakeTurn(withTurnCount, ctx);
  return { state: advanced.state, events: [...awarded.events, ...advanced.events] };
}

export function applyPickExpired(state: DraftState, action: Extract<Action, { type: "clock:pickExpired" }>, ctx: Ctx): ReduceResult {
  if (state.phase !== "snake" || action.teamId !== state.snakePickTurnTeamId) {
    return ok(state, []);
  }

  const teams = teamsByDraftNumber(state.teams);
  const wasNormalTurn = state.snakeRoundTurnsTaken < teams.length;

  if (state.settings.pickExpiryAction === "skip") {
    const deferred = [...state.deferredPicks, { teamId: action.teamId, round: state.snakeRound }];
    const nextState: DraftState = bumpVersion({
      ...state,
      deferredPicks: deferred,
      snakeRoundTurnsTaken: wasNormalTurn ? state.snakeRoundTurnsTaken + 1 : state.snakeRoundTurnsTaken,
    });
    const advanced = advanceSnakeTurn(nextState, ctx);
    return { state: advanced.state, events: advanced.events };
  }

  const candidateId = availablePlayerIds(state).find((playerId) => isValidSnakeCandidate(state, action.teamId, playerId));
  if (!candidateId) {
    // No valid candidate found: fall back to a deferred catch-up rather than corrupting state.
    const deferred = [...state.deferredPicks, { teamId: action.teamId, round: state.snakeRound }];
    const nextState: DraftState = bumpVersion({
      ...state,
      deferredPicks: deferred,
      snakeRoundTurnsTaken: wasNormalTurn ? state.snakeRoundTurnsTaken + 1 : state.snakeRoundTurnsTaken,
    });
    return advanceSnakeTurn(nextState, ctx);
  }

  const awarded = awardNonAuctionPick(state, { teamId: action.teamId, playerId: candidateId, source: "auto", round: state.snakeRound }, ctx);
  const withTurnCount: DraftState = {
    ...awarded.state,
    snakeRoundTurnsTaken: wasNormalTurn ? state.snakeRoundTurnsTaken + 1 : state.snakeRoundTurnsTaken,
  };
  const advanced = advanceSnakeTurn(withTurnCount, ctx);
  return { state: advanced.state, events: [...awarded.events, ...advanced.events] };
}
