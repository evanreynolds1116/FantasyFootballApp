import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, Lot, Pick } from "../model/types.js";
import { currentLot } from "../selectors/lots.js";
import { eligibleTeamIdsForPlayer } from "../selectors/eligibility.js";
import type { Event } from "../events/types.js";
import { freezeCurrentClock } from "./pauseResume.js";
import { reject, type ReduceResult } from "./result.js";

function findLotForAuctionPick(state: DraftState, pick: Pick): Lot | undefined {
  return state.lots.find((l) => l.playerId === pick.playerId && l.state === "awarded" && l.winnerTeamId === pick.teamId);
}

function deriveLastAwardOrPick(state: DraftState, picks: Pick[]): DraftState["lastAwardOrPick"] {
  // Commissioner-added players aren't draft results, so undo never targets them.
  const assigned = new Set(state.commishLog.flatMap((e) => (e.kind === "assign" ? [e.pickId] : [])));
  const last = [...picks].reverse().find((p) => !assigned.has(p.id));
  if (!last) return null;
  if (last.source === "auction") {
    const lot = findLotForAuctionPick({ ...state, picks }, last);
    return { kind: "award", lotId: lot?.id, pickId: last.id };
  }
  return { kind: "pick", pickId: last.id };
}

/**
 * SPEC.md edge case "Commissioner undoes an award": only the most recent
 * award/pick; the current lot is paused, the pick removed, the budget
 * restored and the player goes back in the pool.
 *
 * For an auction award that means the undone lot ends as returnedToPool (the
 * player can be nominated again like any other available player) and the
 * whole draft pauses, freezing whatever clock is live — the undone lot is
 * never reopened, so play simply continues from the current lot on Resume.
 * A snake/make-up pick is just removed.
 */
export function applyAdminUndo(state: DraftState, action: Extract<Action, { type: "admin:undo" }>, ctx: Ctx): ReduceResult {
  if (!state.lastAwardOrPick) {
    return reject(state, action, "NOTHING_TO_UNDO", "There is nothing to undo.");
  }

  const target = state.picks.find((p) => p.id === state.lastAwardOrPick!.pickId);
  if (!target) {
    return reject(state, action, "NOTHING_TO_UNDO", "There is nothing to undo.");
  }

  const remainingPicks = state.picks.filter((p) => p.id !== target.id);
  let next: DraftState = { ...state, picks: remainingPicks, lastAwardOrPick: deriveLastAwardOrPick(state, remainingPicks) };
  const events: Event[] = [];

  if (target.source === "auction") {
    const lot = findLotForAuctionPick(state, target);
    if (lot) {
      const returnedLot: Lot = { ...lot, state: "returnedToPool", winnerTeamId: null, price: null, endsAt: null, remainingMs: null };
      next = { ...next, lots: next.lots.map((l) => (l.id === lot.id ? returnedLot : l)) };
    }

    if (!next.paused) {
      const frozen = freezeCurrentClock(next, ctx);
      next = { ...frozen.state, paused: true };
      events.push({ type: "draft:paused", remainingMs: frozen.remainingMs, breakEndsAt: next.breakEndsAt });
    }

    // The restored budget/spot can make the winner eligible again for the lot
    // now up for bidding, so its eligibility snapshot is refreshed. Only ever
    // widens: undo never takes budget or roster room away from anyone.
    const live = currentLot(next);
    if (live && live.state === "open") {
      const refreshed: Lot = { ...live, eligibleTeamIds: eligibleTeamIdsForPlayer(next, live.playerId) };
      next = { ...next, lots: next.lots.map((l) => (l.id === live.id ? refreshed : l)) };
    }
  }

  events.push({ type: "draft:undo", undone: { kind: target.source === "auction" ? "award" : "pick", teamId: target.teamId, playerId: target.playerId } });
  return { state: bumpVersion(next), events };
}
