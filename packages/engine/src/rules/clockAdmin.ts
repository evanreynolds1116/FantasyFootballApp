import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState } from "../model/types.js";
import { currentLot } from "../selectors/lots.js";
import type { Event } from "../events/types.js";
import { ok, type ReduceResult } from "./result.js";

export function applyAdminAddTime(state: DraftState, action: Extract<Action, { type: "admin:addTime" }>, _ctx: Ctx): ReduceResult {
  const ms = action.seconds * 1000;
  const lot = currentLot(state);

  if (lot && (lot.state === "open" || lot.state === "tieRebid") && lot.endsAt !== null) {
    const updatedLot = { ...lot, endsAt: lot.endsAt + ms };
    return ok(bumpVersion({ ...state, lots: state.lots.map((l) => (l.id === lot.id ? updatedLot : l)) }), []);
  }
  if (state.nominationEndsAt !== null) {
    return ok(bumpVersion({ ...state, nominationEndsAt: state.nominationEndsAt + ms }), []);
  }
  if (state.snakePickEndsAt !== null) {
    return ok(bumpVersion({ ...state, snakePickEndsAt: state.snakePickEndsAt + ms }), []);
  }
  return ok(state, []);
}

export function applyAdminSetClocks(state: DraftState, action: Extract<Action, { type: "admin:setClocks" }>, _ctx: Ctx): ReduceResult {
  const settings = {
    ...state.settings,
    nominationClockSec: action.nomination ?? state.settings.nominationClockSec,
    bidClockSec: action.bid ?? state.settings.bidClockSec,
    tieClockSec: action.tie ?? state.settings.tieClockSec,
    pickClockSec: action.pick ?? state.settings.pickClockSec,
  };
  const nextState = bumpVersion({ ...state, settings });
  const events: Event[] = [
    {
      type: "settings:clocks",
      nomination: settings.nominationClockSec,
      bid: settings.bidClockSec,
      tie: settings.tieClockSec,
      pick: settings.pickClockSec,
    },
  ];
  return { state: nextState, events };
}

export function applyAdminSetRevealTopN(state: DraftState, action: Extract<Action, { type: "admin:setRevealTopN" }>, _ctx: Ctx): ReduceResult {
  const nextState = bumpVersion({ ...state, settings: { ...state.settings, revealTopN: action.revealTopN } });
  const events: Event[] = [{ type: "settings:revealTopN", revealTopN: action.revealTopN }];
  return { state: nextState, events };
}
