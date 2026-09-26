import type { LotId, PlayerId, TeamId } from "../model/types.js";
import type { ClockSetting } from "../settings/types.js";

export type Action =
  | { type: "nominate"; teamId: TeamId; playerId: PlayerId }
  | { type: "bid:submit"; teamId: TeamId; lotId: LotId; amount: number }
  | { type: "bid:pass"; teamId: TeamId; lotId: LotId }
  | { type: "tie:rebid"; teamId: TeamId; lotId: LotId; amount: number }
  | { type: "pick:make"; teamId: TeamId; playerId: PlayerId }
  | { type: "admin:start" }
  | { type: "admin:pause" }
  | { type: "admin:resume" }
  | { type: "admin:break"; minutes: number }
  | { type: "admin:undo" }
  | { type: "admin:addTime"; seconds: number }
  | {
      type: "admin:setClocks";
      nomination?: ClockSetting;
      bid?: ClockSetting;
      tie?: ClockSetting;
      pick?: ClockSetting;
    }
  | { type: "admin:setRevealTopN"; revealTopN: number | "all" }
  | { type: "admin:resolveTie"; lotId: LotId; teamId: TeamId }
  | { type: "admin:voidLot"; lotId: LotId }
  | { type: "admin:markPlayerUnavailable"; playerId: PlayerId }
  // Clock-expiry-driven: dispatched by a phase-2 scheduler off stored endsAt
  // fields in DraftState. The engine never reads a clock itself — these are
  // explicit, parameterized intents just like any other action.
  | { type: "clock:nominationExpired" }
  | { type: "clock:lotExpired"; lotId: LotId }
  | { type: "clock:tieExpired"; lotId: LotId }
  | { type: "clock:pickExpired"; teamId: TeamId };

export type ActionType = Action["type"];
