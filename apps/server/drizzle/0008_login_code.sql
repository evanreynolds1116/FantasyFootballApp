CREATE TABLE IF NOT EXISTS "login_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"link_hash" text NOT NULL,
	"next" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_code_link_hash_unique" UNIQUE("link_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_code_email_idx" ON "login_code" USING btree ("email","created_at");