import type { Action } from "../actions/types.js";
import type { Ctx } from "../clock.js";
import { bumpVersion } from "../model/state.js";
import type { DraftState } from "../model/types.js";
import { startNominationRound, startSnakePhase } from "./auctionTransition.js";
import { reject, type ReduceResult } from "./result.js";

export function applyAdminStart(state: DraftState, action: Extract<Action, { type: "admin:start" }>, ctx: Ctx): ReduceResult {
  if (state.phase !== "setup") {
    return reject(state, action, "INVALID_PHASE", "The draft has already started.");
  }
  const auctionState = bumpVersion({ ...state, phase: "auction" as const });
  if (state.settings.auctionSpots <= 0) {
    return startSnakePhase(auctionState, ctx);
  }
  return startNominationRound(auctionState, ctx, 1);
}
