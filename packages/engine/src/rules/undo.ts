import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState, Lot, Pick } from "../model/types.js";
import type { Event } from "../events/types.js";
import { reject, type ReduceResult } from "./result.js";

function findLotForAuctionPick(state: DraftState, pick: Pick): Lot | undefined {
  return state.lots.find((l) => l.playerId === pick.playerId && l.state === "awarded" && l.winnerTeamId === pick.teamId);
}

function deriveLastAwardOrPick(state: DraftState, picks: Pick[]): DraftState["lastAwardOrPick"] {
  const last = picks[picks.length - 1];
  if (!last) return null;
  if (last.source === "auction") {
    const lot = findLotForAuctionPick({ ...state, picks }, last);
    return { kind: "award", lotId: lot?.id, pickId: last.id };
  }
  return { kind: "pick", pickId: last.id };
}

export function applyAdminUndo(state: DraftState, action: Extract<Action, { type: "admin:undo" }>, _ctx: Ctx): ReduceResult {
  if (!state.lastAwardOrPick) {
    return reject(state, action, "NOTHING_TO_UNDO", "There is nothing to undo.");
  }

  const target = state.picks.find((p) => p.id === state.lastAwardOrPick!.pickId);
  if (!target) {
    return reject(state, action, "NOTHING_TO_UNDO", "There is nothing to undo.");
  }

  const remainingPicks = state.picks.filter((p) => p.id !== target.id);
  let lots = state.lots;
  let paused = state.paused;

  if (target.source === "auction") {
    const lot = findLotForAuctionPick(state, target);
    if (lot) {
      const settings = state.settings;
      const remainingMs = settings.bidClockSec === "off" ? null : settings.bidClockSec * 1000;
      const reopenedLot: Lot = { ...lot, state: "paused", winnerTeamId: null, price: null, endsAt: null, remainingMs };
      lots = state.lots.map((l) => (l.id === lot.id ? reopenedLot : l));
      // Requires an explicit admin:resume before the reopened lot goes live again.
      paused = true;
    }
  }

  const nextState = bumpVersion({
    ...state,
    picks: remainingPicks,
    lots,
    paused,
    lastAwardOrPick: deriveLastAwardOrPick(state, remainingPicks),
  });
  const events: Event[] = [{ type: "draft:undo", undone: { kind: target.source === "auction" ? "award" : "pick", teamId: target.teamId, playerId: target.playerId } }];
  return { state: nextState, events };
}
