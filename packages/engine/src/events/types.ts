import type { Action } from "../actions/types.js";
import type { ErrorCode } from "../errors.js";
import type { DraftPhase, LotId, PickSource, PlayerId, TeamId } from "../model/types.js";
import type { ClockSetting, TieFallback } from "../settings/types.js";

export type RevealedBid = { teamId: TeamId; amount: number };

/**
 * Mirrors SPEC.md's broadcast table, adapted to be transport-agnostic: no
 * `you:private` variant (the engine returns full truth in state; a phase-2
 * server decides what to broadcast to whom). The bid-secrecy invariant is
 * enforced by type shape here: no variant other than lot:reveal and
 * lot:tieRebidRevealed carries an `amount`.
 */
export type Event =
  | { type: "nomination:turn"; teamId: TeamId; endsAt: number | null }
  | {
      type: "nomination:made";
      lotId: LotId;
      playerId: PlayerId;
      teamId: TeamId;
      round: number;
      orderInRound: number;
    }
  | { type: "lot:open"; lotId: LotId; playerId: PlayerId; eligibleTeamIds: TeamId[]; endsAt: number | null }
  | { type: "lot:bidStatus"; lotId: LotId; teamId: TeamId; hasBid: boolean }
  | { type: "lot:closing"; lotId: LotId; endsAt: number }
  | { type: "lot:reveal"; lotId: LotId; bids: RevealedBid[]; winnerTeamId: TeamId | null }
  | {
      type: "lot:tie";
      lotId: LotId;
      tiedTeamIds: TeamId[];
      minBidPerTeam: Record<TeamId, number>;
      tieRound: number;
      endsAt: number | null;
    }
  | { type: "lot:tieRebidRevealed"; lotId: LotId; tieRound: number; bids: RevealedBid[] }
  | { type: "lot:fallback"; lotId: LotId; method: TieFallback; winnerTeamId: TeamId }
  | { type: "lot:awarded"; lotId: LotId; teamId: TeamId; playerId: PlayerId; price: number }
  | { type: "lot:returned"; lotId: LotId; playerId: PlayerId }
  | { type: "lot:cancelled"; lotId: LotId; playerId: PlayerId }
  | { type: "draft:phase"; phase: DraftPhase }
  | { type: "pick:turn"; teamId: TeamId; pickNo: number; endsAt: number | null }
  | { type: "pick:made"; teamId: TeamId; playerId: PlayerId; source: PickSource; pickNo: number }
  | { type: "draft:paused"; remainingMs: number | null; breakEndsAt: number | null }
  | { type: "draft:resumed"; endsAt: number | null }
  | {
      type: "settings:clocks";
      nomination: ClockSetting;
      bid: ClockSetting;
      tie: ClockSetting;
      pick: ClockSetting;
    }
  | { type: "settings:revealTopN"; revealTopN: number | "all" }
  | { type: "draft:undo"; undone: { kind: "award" | "pick"; teamId: TeamId; playerId: PlayerId } }
  | { type: "player:unavailable"; playerId: PlayerId }
  // Phase-2 note: this echoes the full original Action, which may include a
  // bid amount. It must be delivered only to the acting team as a private
  // ack, never broadcast, or it becomes a bid-secrecy leak.
  | { type: "draft:rejected"; action: Action; code: ErrorCode; message: string };

export type EventType = Event["type"];
