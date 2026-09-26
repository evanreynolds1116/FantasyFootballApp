ALTER TABLE "bid" DROP CONSTRAINT "bid_lot_id_lot_id_fk";
--> statement-breakpoint
ALTER TABLE "bid" DROP CONSTRAINT "bid_pkey";
--> statement-breakpoint
ALTER TABLE "lot" DROP CONSTRAINT "lot_pkey";
--> statement-breakpoint
ALTER TABLE "pick" DROP CONSTRAINT "pick_pkey";
--> statement-breakpoint
ALTER TABLE "bid" ADD COLUMN "draft_id" uuid;
--> statement-breakpoint
UPDATE "bid" SET "draft_id" = "lot"."draft_id" FROM "lot" WHERE "lot"."id" = "bid"."lot_id";
--> statement-breakpoint
ALTER TABLE "bid" ALTER COLUMN "draft_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "bid" ADD CONSTRAINT "bid_draft_id_id_pk" PRIMARY KEY("draft_id","id");
--> statement-breakpoint
ALTER TABLE "lot" ADD CONSTRAINT "lot_draft_id_id_pk" PRIMARY KEY("draft_id","id");
--> statement-breakpoint
ALTER TABLE "pick" ADD CONSTRAINT "pick_draft_id_id_pk" PRIMARY KEY("draft_id","id");
--> statement-breakpoint
ALTER TABLE "bid" ADD CONSTRAINT "bid_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bid" ADD CONSTRAINT "bid_draft_id_lot_id_lot_draft_id_id_fk" FOREIGN KEY ("draft_id","lot_id") REFERENCES "public"."lot"("draft_id","id") ON DELETE cascade ON UPDATE no action;
