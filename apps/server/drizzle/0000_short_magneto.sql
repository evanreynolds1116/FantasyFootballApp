CREATE TYPE "public"."draft_phase" AS ENUM('setup', 'auction', 'snake', 'makeup', 'complete');--> statement-breakpoint
CREATE TYPE "public"."lot_state" AS ENUM('queued', 'open', 'paused', 'closed', 'revealed', 'tieRebid', 'fallback', 'awarded', 'returnedToPool', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."no_bid_action" AS ENUM('awardNominator', 'returnToPool');--> statement-breakpoint
CREATE TYPE "public"."nomination_order" AS ENUM('snake', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."pick_expiry_action" AS ENUM('autoPick', 'skip');--> statement-breakpoint
CREATE TYPE "public"."pick_source" AS ENUM('auction', 'snake', 'makeup', 'auto');--> statement-breakpoint
CREATE TYPE "public"."tie_fallback" AS ENUM('randomDraw', 'commissionerDecides', 'higherBudget', 'earlierTeamNumber');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"actor_user_id" uuid,
	"type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"tie_round" integer DEFAULT 0 NOT NULL,
	"amount" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"phase" "draft_phase" DEFAULT 'setup' NOT NULL,
	"auction_round" integer DEFAULT 0 NOT NULL,
	"current_lot_id" uuid,
	"current_pick_no" integer,
	"paused" boolean DEFAULT false NOT NULL,
	"break_ends_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"engine_state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "draft_settings" (
	"league_id" uuid PRIMARY KEY NOT NULL,
	"team_count" integer NOT NULL,
	"budget" integer NOT NULL,
	"auction_spots" integer NOT NULL,
	"roster_size" integer NOT NULL,
	"min_bid" integer NOT NULL,
	"bid_step" integer NOT NULL,
	"tie_min_raise" integer NOT NULL,
	"nomination_clock_sec" integer,
	"bid_clock_sec" integer,
	"tie_clock_sec" integer,
	"pick_clock_sec" integer,
	"early_close" boolean NOT NULL,
	"max_tie_rounds" integer,
	"tie_fallback" "tie_fallback" NOT NULL,
	"no_bid_action" "no_bid_action" NOT NULL,
	"nomination_order" "nomination_order" NOT NULL,
	"reveal_top_n" text NOT NULL,
	"pick_expiry_action" "pick_expiry_action" NOT NULL,
	"broke_teams_fill_at_end" boolean NOT NULL,
	"nominator_must_bid" boolean NOT NULL,
	"position_groups" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"commissioner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"order_in_round" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"nominated_by_team_id" uuid NOT NULL,
	"state" "lot_state" NOT NULL,
	"tie_round" integer DEFAULT 0 NOT NULL,
	"ends_at" timestamp with time zone,
	"remaining_ms" integer,
	"winner_team_id" uuid,
	"price" integer,
	"eligible_team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tied_team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"pick_no" integer NOT NULL,
	"round" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"source" "pick_source" NOT NULL,
	"price" integer,
	"made_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"mfl_id" text,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"nfl_team" text,
	"bye_week" integer,
	"status" text,
	"custom" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"draft_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"auth_provider" text DEFAULT 'dev' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid" ADD CONSTRAINT "bid_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid" ADD CONSTRAINT "bid_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft" ADD CONSTRAINT "draft_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft_settings" ADD CONSTRAINT "draft_settings_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "league" ADD CONSTRAINT "league_commissioner_user_id_user_id_fk" FOREIGN KEY ("commissioner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot" ADD CONSTRAINT "lot_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot" ADD CONSTRAINT "lot_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot" ADD CONSTRAINT "lot_nominated_by_team_id_team_id_fk" FOREIGN KEY ("nominated_by_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lot" ADD CONSTRAINT "lot_winner_team_id_team_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pick" ADD CONSTRAINT "pick_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pick" ADD CONSTRAINT "pick_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pick" ADD CONSTRAINT "pick_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player" ADD CONSTRAINT "player_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team" ADD CONSTRAINT "team_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team" ADD CONSTRAINT "team_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_event_draft_seq_idx" ON "audit_event" USING btree ("draft_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_lot_tie_round_team_idx" ON "bid" USING btree ("lot_id","tie_round","team_id","superseded");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lot_draft_round_idx" ON "lot" USING btree ("draft_id","round","order_in_round");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_one_open_per_draft_idx" ON "lot" USING btree ("draft_id") WHERE "lot"."state" not in ('queued', 'awarded', 'returnedToPool', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pick_draft_player_idx" ON "pick" USING btree ("draft_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pick_draft_pick_no_idx" ON "pick" USING btree ("draft_id","pick_no");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_league_mfl_id_idx" ON "player" USING btree ("league_id","mfl_id") WHERE "player"."mfl_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_league_idx" ON "player" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_league_draft_number_idx" ON "team" USING btree ("league_id","draft_number");