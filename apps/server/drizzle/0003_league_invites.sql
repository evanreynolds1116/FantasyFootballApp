ALTER TABLE "league" ADD COLUMN "invite_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_league_user_idx" ON "team" USING btree ("league_id","user_id") WHERE "team"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "league" ADD CONSTRAINT "league_invite_code_unique" UNIQUE("invite_code");