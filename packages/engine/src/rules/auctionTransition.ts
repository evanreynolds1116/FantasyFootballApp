import type { Ctx } from "../clock.js";
import { endsAtFor } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, Lot } from "../model/types.js";
import { allTeamsFullOrBroke, eligibleTeamIdsForPlayer } from "../selectors/eligibility.js";
import { lotsInRound } from "../selectors/lots.js";
import { eligibleNominationOrderForRound } from "../selectors/order.js";
import type { Event } from "../events/types.js";
import { beginSnake } from "./snake.js";
import type { ReduceResult } from "./result.js";

/**
 * Opens a queued lot for bidding: snapshots eligibility, starts the bid
 * clock, emits lot:open.
 */
export function openLot(state: DraftState, lot: Lot, ctx: Ctx): ReduceResult {
  const eligibleTeamIds = eligibleTeamIdsForPlayer(state, lot.playerId);
  const endsAt = endsAtFor(ctx.now, state.settings.bidClockSec);

  const updatedLot: Lot = { ...lot, state: "open", eligibleTeamIds, endsAt };
  const nextState = bumpVersion({
    ...state,
    lots: state.lots.map((l) => (l.id === lot.id ? updatedLot : l)),
  });

  const events: Event[] = [
    { type: "lot:open", lotId: lot.id, playerId: lot.playerId, eligibleTeamIds, endsAt },
  ];
  return { state: nextState, events };
}

/**
 * Starts the nomination sub-phase for `round`: computes the eligible team
 * order fresh (eligibility can't change mid-nomination-collection, since no
 * picks are made until the round's bidding sub-phase begins) and puts the
 * first team on the clock. Falls back to starting the snake phase if no team
 * is eligible to nominate.
 */
export function startNominationRound(state: DraftState, ctx: Ctx, round: number): ReduceResult {
  const order = eligibleNominationOrderForRound(state, round);

  if (order.length === 0) {
    return startSnakePhase(state, ctx);
  }

  const nominationEndsAt = endsAtFor(ctx.now, state.settings.nominationClockSec);
  const nextState = bumpVersion({
    ...state,
    auctionRound: round,
    nominationTurnTeamId: order[0] as string,
    nominationEndsAt,
    nominationRemainingMs: null,
  });
  const events: Event[] = [{ type: "nomination:turn", teamId: order[0] as string, endsAt: nominationEndsAt }];
  return { state: nextState, events };
}

/**
 * Called once a lot has reached a terminal state (awarded, returned to
 * pool, or cancelled). Decides what happens next: if every team is now
 * full-or-broke, the auction ends immediately (even mid-round) and any
 * still-queued lots in the current round are cancelled; otherwise the next
 * queued lot in the round opens, or — if the round's lots are all done — the
 * next nomination round begins.
 */
export function advanceAfterLotResolved(state: DraftState, ctx: Ctx): ReduceResult {
  if (allTeamsFullOrBroke(state)) {
    return cancelQueuedLotsAndStartSnake(state, ctx);
  }

  const roundLots = lotsInRound(state, state.auctionRound);
  const nextQueued = [...roundLots].sort((a, b) => a.orderInRound - b.orderInRound).find((l) => l.state === "queued");

  if (nextQueued) {
    return openLot(state, nextQueued, ctx);
  }

  // Round's lots are all terminal: start the next round.
  return startNominationRound(state, ctx, state.auctionRound + 1);
}

function cancelQueuedLotsAndStartSnake(state: DraftState, ctx: Ctx): ReduceResult {
  const events: Event[] = [];
  const cancelledLots = state.lots.map((l) => {
    if (l.state === "queued") {
      events.push({ type: "lot:cancelled", lotId: l.id, playerId: l.playerId });
      return { ...l, state: "cancelled" as const };
    }
    return l;
  });

  const { state: snakeState, events: snakeEvents } = startSnakePhase(
    bumpVersion({ ...state, lots: cancelledLots }),
    ctx,
  );
  return { state: snakeState, events: [...events, ...snakeEvents] };
}

/** Transitions the draft from "auction" to "snake" and opens the first snake pick turn. */
export function startSnakePhase(state: DraftState, ctx: Ctx): ReduceResult {
  const nextState = bumpVersion({
    ...state,
    phase: "snake" as const,
    nominationTurnTeamId: null,
    nominationEndsAt: null,
    nominationRemainingMs: null,
  });
  const events: Event[] = [{ type: "draft:phase", phase: "snake" }];
  const begun = beginSnake(nextState, ctx);
  return { state: begun.state, events: [...events, ...begun.events] };
}
