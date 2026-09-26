import type { DraftSettings } from "../settings/types.js";

export type TeamId = string;
export type PlayerId = string;
export type LotId = string;

export type Team = {
  id: TeamId;
  /** 1..N, immutable draft-order seat assigned before the draft starts. */
  draftNumber: number;
  name: string;
};

export type Player = {
  id: PlayerId;
  name: string;
  position: string;
  nflTeam?: string;
  byeWeek?: number;
};

export type LotState =
  | "queued"
  | "open"
  | "paused"
  | "closed"
  | "revealed"
  | "tieRebid"
  | "fallback"
  | "awarded"
  | "returnedToPool"
  | "cancelled";

export type Lot = {
  id: LotId;
  round: number;
  orderInRound: number;
  playerId: PlayerId;
  nominatedByTeamId: TeamId;
  state: LotState;
  /** 0 pre-tie; increments once per rebid round. */
  tieRound: number;
  /** Absolute ms timestamp. null when the relevant clock is off or not running. */
  endsAt: number | null;
  /** Set on pause; ms remaining on whichever clock was running. */
  remainingMs: number | null;
  /** Snapshot at open: teams that could bid when the lot opened. */
  eligibleTeamIds: TeamId[];
  /** Populated once a tie is detected; shrinks each rebid round. */
  tiedTeamIds: TeamId[];
  winnerTeamId: TeamId | null;
  price: number | null;
  /**
   * The reveal setting in force when this lot's opening sealed round was
   * revealed — how many of those bids everyone has seen. Unset until the
   * reveal (and for lots revealed before this was recorded).
   */
  revealTopN?: number | "all";
};

export type Bid = {
  id: string;
  lotId: LotId;
  teamId: TeamId;
  /** 0 for the initial sealed bid, 1+ for tie rebids. */
  tieRound: number;
  /** 0 for a pass. */
  amount: number;
  receivedAt: number;
  superseded: boolean;
  /**
   * A locked-in "no bid" on the opening sealed round: counts as in for early
   * close and can be changed like any bid, but is never a bid when the lot
   * is decided. Absent/false for real bids.
   */
  pass?: boolean;
};

export type PickSource = "auction" | "snake" | "makeup" | "auto";

export type Pick = {
  id: string;
  /** Global sequence across the whole draft. */
  pickNo: number;
  /** Meaning depends on phase (auction round / snake round / makeup round). */
  round: number;
  teamId: TeamId;
  playerId: PlayerId;
  source: PickSource;
  /** Set for auction-sourced picks, null for snake/makeup/auto. */
  price: number | null;
  madeAt: number;
};

export type DraftPhase = "setup" | "auction" | "snake" | "makeup" | "complete";

/** A deferred pick-clock-expiry "skip" awaiting an end-of-round catch-up turn. */
export type DeferredPick = {
  teamId: TeamId;
  round: number;
};

export type DraftState = {
  settings: DraftSettings;
  teams: Team[];
  /** Full pool; availability is derived from picks/lots/unavailablePlayerIds. */
  players: Player[];
  phase: DraftPhase;
  paused: boolean;
  breakEndsAt: number | null;
  /** Increments on every state-changing reduce() call. */
  version: number;
  /** Monotonic counter used to mint deterministic, always-unique ids (never reused, even after undo). */
  nextId: number;

  auctionRound: number;
  nominationTurnTeamId: TeamId | null;
  nominationEndsAt: number | null;
  nominationRemainingMs: number | null;

  /** Append-only. Current lot = first non-terminal lot in round/order. */
  lots: Lot[];
  /** Append-only, includes superseded rows (audit trail). */
  bids: Bid[];
  /** Append-only; source of truth for budgets/rosters (derived, not stored). */
  picks: Pick[];

  snakePickTurnTeamId: TeamId | null;
  snakePickEndsAt: number | null;
  snakePickRemainingMs: number | null;
  /** Current round number within phase "snake". */
  snakeRound: number;
  /** +1 ascending draftNumber, -1 descending; carried into makeup. */
  snakeDirection: 1 | -1;
  /** Count of this round's normal (non-catch-up) turns resolved so far. */
  snakeRoundTurnsTaken: number;
  /** Teams skipped by pick-clock expiry, owed an end-of-round catch-up turn. */
  deferredPicks: DeferredPick[];

  /** Current round number within phase "makeup". */
  makeupRound: number;
  /** Count of this makeup round's normal (non-catch-up) turns resolved so far. */
  makeupRoundTurnsTaken: number;

  /** Players marked unavailable by the commissioner (admin:markPlayerUnavailable). */
  unavailablePlayerIds: PlayerId[];

  /**
   * Each manager's ranked queue (FR-19), best first. Private: only that
   * manager may ever see it. Auto-nominate and auto-pick take the first
   * player in it that's available (and, for picks, fits the roster). May
   * hold players who have since been taken — they're skipped, not removed.
   */
  queues: Record<TeamId, PlayerId[]>;

  lastAwardOrPick: { kind: "award" | "pick"; lotId?: LotId; pickId: string } | null;
};
