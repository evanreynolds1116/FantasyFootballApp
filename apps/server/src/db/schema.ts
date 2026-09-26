import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --- Enums, mirroring the engine's exact literal unions ---------------------

export const draftPhaseEnum = pgEnum("draft_phase", ["setup", "auction", "snake", "makeup", "complete"]);

export const lotStateEnum = pgEnum("lot_state", [
  "queued",
  "open",
  "paused",
  "closed",
  "revealed",
  "tieRebid",
  "fallback",
  "awarded",
  "returnedToPool",
  "cancelled",
]);

export const pickSourceEnum = pgEnum("pick_source", ["auction", "snake", "makeup", "auto"]);

export const tieFallbackEnum = pgEnum("tie_fallback", [
  "randomDraw",
  "commissionerDecides",
  "higherBudget",
  "earlierTeamNumber",
]);

export const noBidActionEnum = pgEnum("no_bid_action", ["awardNominator", "returnToPool"]);

export const nominationOrderEnum = pgEnum("nomination_order", ["snake", "fixed"]);

export const pickExpiryActionEnum = pgEnum("pick_expiry_action", ["autoPick", "skip"]);

// --- Tables -------------------------------------------------------------

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  authProvider: text("auth_provider").notNull().default("dev"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  token: text("token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const league = pgTable("league", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  commissionerUserId: uuid("commissioner_user_id")
    .notNull()
    .references(() => user.id),
  /** The league's one reusable invite code (/join/:code). Nullable only for leagues created before invites existed. */
  inviteCode: text("invite_code").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** ClockSetting columns (nomination/bid/tie/pick) are nullable integers: null = "off", matching the engine's `number | "off"`. */
export const draftSettings = pgTable("draft_settings", {
  leagueId: uuid("league_id")
    .primaryKey()
    .references(() => league.id, { onDelete: "cascade" }),
  teamCount: integer("team_count").notNull(),
  budget: integer("budget").notNull(),
  auctionSpots: integer("auction_spots").notNull(),
  rosterSize: integer("roster_size").notNull(),
  minBid: integer("min_bid").notNull(),
  bidStep: integer("bid_step").notNull(),
  tieMinRaise: integer("tie_min_raise").notNull(),
  nominationClockSec: integer("nomination_clock_sec"),
  bidClockSec: integer("bid_clock_sec"),
  tieClockSec: integer("tie_clock_sec"),
  pickClockSec: integer("pick_clock_sec"),
  earlyClose: boolean("early_close").notNull(),
  maxTieRounds: integer("max_tie_rounds"),
  tieFallback: tieFallbackEnum("tie_fallback").notNull(),
  noBidAction: noBidActionEnum("no_bid_action").notNull(),
  nominationOrder: nominationOrderEnum("nomination_order").notNull(),
  /** "all" or a numeric string, mirroring the engine's `number | "all"`. */
  revealTopN: text("reveal_top_n").notNull(),
  pickExpiryAction: pickExpiryActionEnum("pick_expiry_action").notNull(),
  brokeTeamsFillAtEnd: boolean("broke_teams_fill_at_end").notNull(),
  /** Array of { name, positions, min, max }; null = position limits off. */
  positionGroups: jsonb("position_groups"),
});

export const team = pgTable(
  "team",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => league.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id),
    name: text("name").notNull(),
    draftNumber: integer("draft_number").notNull(),
  },
  (t) => [
    uniqueIndex("team_league_draft_number_idx").on(t.leagueId, t.draftNumber),
    // One team per manager per league — enforced here so two racing claims can't both win.
    uniqueIndex("team_league_user_idx").on(t.leagueId, t.userId).where(sql`${t.userId} is not null`),
  ],
);

export const player = pgTable(
  "player",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => league.id, { onDelete: "cascade" }),
    mflId: text("mfl_id"),
    name: text("name").notNull(),
    position: text("position").notNull(),
    nflTeam: text("nfl_team"),
    byeWeek: integer("bye_week"),
    status: text("status"),
    custom: boolean("custom").notNull().default(false),
  },
  (t) => [
    uniqueIndex("player_league_mfl_id_idx").on(t.leagueId, t.mflId).where(sql`${t.mflId} is not null`),
    index("player_league_idx").on(t.leagueId),
  ],
);

export const draft = pgTable("draft", {
  id: uuid("id").primaryKey().defaultRandom(),
  leagueId: uuid("league_id")
    .notNull()
    .references(() => league.id, { onDelete: "cascade" }),
  phase: draftPhaseEnum("phase").notNull().default("setup"),
  auctionRound: integer("auction_round").notNull().default(0),
  currentLotId: text("current_lot_id"),
  /** Denormalized convenience column, derivable as picks.length + 1; not authoritative. */
  currentPickNo: integer("current_pick_no"),
  paused: boolean("paused").notNull().default(false),
  breakEndsAt: timestamp("break_ends_at", { withTimezone: true }),
  version: integer("version").notNull().default(0),
  /**
   * Pure scheduler/turn-tracking bookkeeping that has no natural row shape
   * and no query value outside "reconstruct this exact DraftState" — see
   * db/loadDraftState.ts and db/persistReduceResult.ts for the exact shape
   * (EngineBookkeeping in db/engineState.ts).
   */
  engineState: jsonb("engine_state").notNull(),
});

export const lot = pgTable(
  "lot",
  {
    // Engine-minted id (e.g. "lot_1", via allocateId) — not globally unique on
    // its own: the engine's id counter restarts at 1 per draft, so uniqueness
    // is only guaranteed scoped to (draftId, id) — see the composite PK below.
    id: text("id").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => draft.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    orderInRound: integer("order_in_round").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => player.id),
    nominatedByTeamId: uuid("nominated_by_team_id")
      .notNull()
      .references(() => team.id),
    state: lotStateEnum("state").notNull(),
    tieRound: integer("tie_round").notNull().default(0),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    remainingMs: integer("remaining_ms"),
    winnerTeamId: uuid("winner_team_id").references(() => team.id),
    price: integer("price"),
    /** Point-in-time snapshot per the engine's own semantics — not derivable, must be stored. */
    eligibleTeamIds: jsonb("eligible_team_ids").notNull().default(sql`'[]'::jsonb`),
    tiedTeamIds: jsonb("tied_team_ids").notNull().default(sql`'[]'::jsonb`),
    /** Reveal setting in force when the lot's opening round was revealed: "all" or a numeric string; null until then. */
    revealTopN: text("reveal_top_n"),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.id] }),
    index("lot_draft_round_idx").on(t.draftId, t.round, t.orderInRound),
    // SPEC.md: "one open lot per draft at a time" — enforced at the DB level.
    uniqueIndex("lot_one_open_per_draft_idx")
      .on(t.draftId)
      .where(sql`${t.state} not in ('queued', 'awarded', 'returnedToPool', 'cancelled')`),
  ],
);

export const bid = pgTable(
  "bid",
  {
    // Engine-minted id (e.g. "bid_3") — see the lot table's comment on why
    // this isn't globally unique on its own.
    id: text("id").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => draft.id, { onDelete: "cascade" }),
    lotId: text("lot_id").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id),
    tieRound: integer("tie_round").notNull().default(0),
    amount: integer("amount").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    superseded: boolean("superseded").notNull().default(false),
    /** A locked-in pass (amount stored as 0) — never a bid when the lot is decided. */
    pass: boolean("pass").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.id] }),
    foreignKey({ columns: [t.draftId, t.lotId], foreignColumns: [lot.draftId, lot.id] }).onDelete("cascade"),
    index("bid_lot_tie_round_team_idx").on(t.lotId, t.tieRound, t.teamId, t.superseded),
  ],
);

export const pick = pgTable(
  "pick",
  {
    // Engine-minted id (e.g. "pick_5") — see the lot table's comment on why
    // this isn't globally unique on its own.
    id: text("id").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => draft.id, { onDelete: "cascade" }),
    pickNo: integer("pick_no").notNull(),
    round: integer("round").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id),
    playerId: uuid("player_id")
      .notNull()
      .references(() => player.id),
    source: pickSourceEnum("source").notNull(),
    price: integer("price"),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.id] }),
    // SPEC.md: "a player appears in at most one pick per draft" (unique index).
    uniqueIndex("pick_draft_player_idx").on(t.draftId, t.playerId),
    uniqueIndex("pick_draft_pick_no_idx").on(t.draftId, t.pickNo),
  ],
);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => draft.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    actorUserId: uuid("actor_user_id"),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("audit_event_draft_seq_idx").on(t.draftId, t.seq)],
);
