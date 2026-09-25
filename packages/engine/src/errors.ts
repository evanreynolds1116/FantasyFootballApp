/**
 * SPEC.md's 8 ack error codes, plus phase-1 additions needed by rules as
 * designed (INVALID_PHASE, NOTHING_TO_UNDO, NOT_TIE_FALLBACK) — see plan
 * section 2.6.
 */
export type ErrorCode =
  | "BID_TOO_LOW"
  | "OVER_BUDGET"
  | "LOT_CLOSED"
  | "NOT_ELIGIBLE"
  | "POSITION_LIMIT"
  | "NOT_YOUR_TURN"
  | "PLAYER_TAKEN"
  | "DRAFT_PAUSED"
  | "INVALID_PHASE"
  | "NOTHING_TO_UNDO"
  | "NOT_TIE_FALLBACK";
