import type { LotId, PlayerId, RosterSlot, TeamId } from "../model/types.js";
import type { ClockSetting } from "../settings/types.js";

export type Action =
  | { type: "nominate"; teamId: TeamId; playerId: PlayerId }
  | { type: "bid:submit"; teamId: TeamId; lotId: LotId; amount: number }
  | { type: "bid:pass"; teamId: TeamId; lotId: LotId }
  | { type: "queue:update"; teamId: TeamId; playerIds: PlayerId[] }
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
  | { type: "admin:markPlayerAvailable"; playerId: PlayerId }
  /** Adds (or, negative, removes) money from a team's budget. */
  | { type: "admin:adjustBudget"; teamId: TeamId; amount: number; reason: string }
  /** Takes a player off a roster and back into the pool; an auction price is refunded. */
  | { type: "admin:removePick"; pickId: string }
  /** Puts an available player into one of the team's open roster spots; `price` is required for an auction spot. */
  | { type: "admin:assignPlayer"; teamId: TeamId; playerId: PlayerId; slot: RosterSlot; price?: number }
  // Clock-expiry-driven: dispatched by a phase-2 scheduler off stored endsAt
  // fields in DraftState. The engine never reads a clock itself — these are
  // explicit, parameterized intents just like any other action.
  | { type: "clock:nominationExpired" }
  | { type: "clock:lotExpired"; lotId: LotId }
  | { type: "clock:tieExpired"; lotId: LotId }
  | { type: "clock:pickExpired"; teamId: TeamId };

export type ActionType = Action["type"];
