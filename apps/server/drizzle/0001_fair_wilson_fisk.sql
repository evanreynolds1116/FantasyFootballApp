ALTER TABLE "bid" DROP CONSTRAINT "bid_lot_id_lot_id_fk";--> statement-breakpoint
ALTER TABLE "bid" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "bid" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bid" ALTER COLUMN "lot_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "draft" ALTER COLUMN "current_lot_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "lot" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "lot" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pick" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pick" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bid" ADD CONSTRAINT "bid_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE cascade ON UPDATE no action;
