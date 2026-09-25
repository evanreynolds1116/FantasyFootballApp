import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { endsAtFor } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, TeamId } from "../model/types.js";
import { auctionDesignatedSpotsRemaining, auctionSpotsFilled } from "../selectors/budget.js";
import { availablePlayerIds, isPlayerAvailable } from "../selectors/lots.js";
import { directionForRound, orderForRound, teamsByDraftNumber } from "../selectors/order.js";
import { remainingMinimumsReachable, wouldExceedPositionMax } from "../selectors/roster.js";
import type { Event } from "../events/types.js";
import { awardNonAuctionPick } from "./award.js";
import { ok, reject, type ReduceResult } from "./result.js";

/** Teams that ended the auction with fewer than settings.auctionSpots auction-won picks. Frozen once auction ends. */
function baseBrokeTeamIds(state: DraftState): TeamId[] {
  return teamsByDraftNumber(state.teams).filter((id) => auctionSpotsFilled(state, id) < state.settings.auctionSpots);
}

function stillNeedingMakeup(state: DraftState): TeamId[] {
  return baseBrokeTeamIds(state).filter((id) => auctionDesignatedSpotsRemaining(state, id) > 0);
}

function emitPickTurn(state: DraftState, teamId: TeamId, ctx: Ctx): ReduceResult {
  const endsAt = endsAtFor(ctx.now, state.settings.pickClockSec);
  const nextState = bumpVersion({ ...state, snakePickTurnTeamId: teamId, snakePickEndsAt: endsAt, snakePickRemainingMs: null });
  const events: Event[] = [{ type: "pick:turn", teamId, pickNo: state.picks.length + 1, endsAt }];
  return { state: nextState, events };
}

export function beginMakeup(state: DraftState, ctx: Ctx): ReduceResult {
  const nextState = bumpVersion({ ...state, phase: "makeup" as const, makeupRound: 1, makeupRoundTurnsTaken: 0 });
  const events: Event[] = [{ type: "draft:phase", phase: "makeup" }];
  const advanced = advanceMakeupTurn(nextState, ctx);
  return { state: advanced.state, events: [...events, ...advanced.events] };
}

function advanceMakeupTurn(state: DraftState, ctx: Ctx): ReduceResult {
  const base = baseBrokeTeamIds(state);
  const order = orderForRound(
    base.filter((id) => auctionDesignatedSpotsRemaining(state, id) > 0),
    state.makeupRound,
    state.snakeDirection,
  );

  if (state.makeupRoundTurnsTaken < order.length) {
    const teamId = order[state.makeupRoundTurnsTaken] as TeamId;
    return emitPickTurn(state, teamId, ctx);
  }

  if (stillNeedingMakeup(state).length === 0) {
    const nextState = bumpVersion({ ...state, phase: "complete" as const, snakePickTurnTeamId: null, snakePickEndsAt: null });
    return { state: nextState, events: [{ type: "draft:phase", phase: "complete" }] };
  }

  const nextRound = state.makeupRound + 1;
  const nextState: DraftState = { ...state, makeupRound: nextRound, makeupRoundTurnsTaken: 0 };
  return advanceMakeupTurn(nextState, ctx);
}

function isValidMakeupCandidate(state: DraftState, teamId: TeamId, playerId: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  if (wouldExceedPositionMax(state, teamId, player.position)) return false;
  return remainingMinimumsReachable(state, teamId, player.position);
}

export function applyMakeupPickMake(state: DraftState, action: Extract<Action, { type: "pick:make" }>, ctx: Ctx): ReduceResult {
  if (state.phase !== "makeup") return reject(state, action, "INVALID_PHASE", "The make-up phase is not active.");
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

  const order = orderForRound(
    baseBrokeTeamIds(state).filter((id) => auctionDesignatedSpotsRemaining(state, id) > 0),
    state.makeupRound,
    state.snakeDirection,
  );
  const wasNormalTurn = state.makeupRoundTurnsTaken < order.length;
  const awarded = awardNonAuctionPick(state, { teamId: action.teamId, playerId: action.playerId, source: "makeup", round: state.makeupRound }, ctx);
  const withTurnCount: DraftState = {
    ...awarded.state,
    makeupRoundTurnsTaken: wasNormalTurn ? state.makeupRoundTurnsTaken + 1 : state.makeupRoundTurnsTaken,
  };
  const advanced = advanceMakeupTurn(withTurnCount, ctx);
  return { state: advanced.state, events: [...awarded.events, ...advanced.events] };
}

export function applyMakeupPickExpired(state: DraftState, action: Extract<Action, { type: "clock:pickExpired" }>, ctx: Ctx): ReduceResult {
  if (state.phase !== "makeup" || action.teamId !== state.snakePickTurnTeamId) {
    return ok(state, []);
  }

  const order = orderForRound(
    baseBrokeTeamIds(state).filter((id) => auctionDesignatedSpotsRemaining(state, id) > 0),
    state.makeupRound,
    state.snakeDirection,
  );
  const wasNormalTurn = state.makeupRoundTurnsTaken < order.length;
  const bumpTurns = (s: DraftState): DraftState => ({
    ...s,
    makeupRoundTurnsTaken: wasNormalTurn ? state.makeupRoundTurnsTaken + 1 : state.makeupRoundTurnsTaken,
  });

  if (state.settings.pickExpiryAction === "skip") {
    // Deferred catch-ups aren't modeled for the (rare) make-up phase; the
    // team keeps its place and simply gets asked again next round via the
    // normal shrinking-order recompute, since it still needs a pick.
    const advanced = advanceMakeupTurn(bumpTurns(state), ctx);
    return { state: advanced.state, events: advanced.events };
  }

  const candidateId = availablePlayerIds(state).find((playerId) => isValidMakeupCandidate(state, action.teamId, playerId));
  if (!candidateId) {
    const advanced = advanceMakeupTurn(bumpTurns(state), ctx);
    return { state: advanced.state, events: advanced.events };
  }

  const awarded = awardNonAuctionPick(state, { teamId: action.teamId, playerId: candidateId, source: "makeup", round: state.makeupRound }, ctx);
  const advanced = advanceMakeupTurn(bumpTurns(awarded.state), ctx);
  return { state: advanced.state, events: [...awarded.events, ...advanced.events] };
}
