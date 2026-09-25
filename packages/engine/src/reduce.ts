import type { Action } from "./actions/types.js";
import type { Ctx } from "./clock.js";
import type { DraftState } from "./model/types.js";
import { applyAdminStart } from "./rules/start.js";
import { applyNominate, applyNominationExpired } from "./rules/nomination.js";
import { applyBidSubmit } from "./rules/bidding.js";
import { applyLotExpired } from "./rules/reveal.js";
import { applyResolveTie, applyTieExpired, applyTieRebid } from "./rules/tie.js";
import { applyPickExpired as applySnakePickExpired, applyPickMake as applySnakePickMake } from "./rules/snake.js";
import { applyMakeupPickExpired, applyMakeupPickMake } from "./rules/makeup.js";
import { applyAdminBreak, applyAdminPause, applyAdminResume } from "./rules/pauseResume.js";
import { applyAdminAddTime, applyAdminSetClocks, applyAdminSetRevealTopN } from "./rules/clockAdmin.js";
import { applyMarkPlayerUnavailable, applyVoidLot } from "./rules/lotAdmin.js";
import { applyAdminUndo } from "./rules/undo.js";
import { reject, type ReduceResult } from "./rules/result.js";

/**
 * The single entry point: (state, action, ctx) -> { state, events }. Never
 * throws. Commissioner (admin:*) actions always run, even while paused —
 * everything else is locked out with DRAFT_PAUSED while the draft is
 * paused, since pausing freezes every clock and locks entry for everyone.
 */
export function reduce(state: DraftState, action: Action, ctx: Ctx): ReduceResult {
  if (state.paused && !action.type.startsWith("admin:")) {
    return reject(state, action, "DRAFT_PAUSED", "The draft is paused.");
  }

  switch (action.type) {
    case "admin:start":
      return applyAdminStart(state, action, ctx);
    case "nominate":
      return applyNominate(state, action, ctx);
    case "clock:nominationExpired":
      return applyNominationExpired(state, action, ctx);
    case "bid:submit":
      return applyBidSubmit(state, action, ctx);
    case "clock:lotExpired":
      return applyLotExpired(state, action, ctx);
    case "tie:rebid":
      return applyTieRebid(state, action, ctx);
    case "clock:tieExpired":
      return applyTieExpired(state, action, ctx);
    case "admin:resolveTie":
      return applyResolveTie(state, action, ctx);
    case "pick:make":
      if (state.phase === "snake") return applySnakePickMake(state, action, ctx);
      if (state.phase === "makeup") return applyMakeupPickMake(state, action, ctx);
      return reject(state, action, "INVALID_PHASE", "No pick phase is active.");
    case "clock:pickExpired":
      if (state.phase === "snake") return applySnakePickExpired(state, action, ctx);
      if (state.phase === "makeup") return applyMakeupPickExpired(state, action, ctx);
      return reject(state, action, "INVALID_PHASE", "No pick phase is active.");
    case "admin:pause":
      return applyAdminPause(state, action, ctx);
    case "admin:resume":
      return applyAdminResume(state, action, ctx);
    case "admin:break":
      return applyAdminBreak(state, action, ctx);
    case "admin:addTime":
      return applyAdminAddTime(state, action, ctx);
    case "admin:setClocks":
      return applyAdminSetClocks(state, action, ctx);
    case "admin:setRevealTopN":
      return applyAdminSetRevealTopN(state, action, ctx);
    case "admin:voidLot":
      return applyVoidLot(state, action, ctx);
    case "admin:markPlayerUnavailable":
      return applyMarkPlayerUnavailable(state, action, ctx);
    case "admin:undo":
      return applyAdminUndo(state, action, ctx);
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
