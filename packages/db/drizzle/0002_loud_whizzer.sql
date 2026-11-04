ALTER TABLE "app"."slots" DROP CONSTRAINT "slot_date_start";--> statement-breakpoint
ALTER TABLE "app"."slots" ADD CONSTRAINT "slot_date_interval" UNIQUE("date","start_minute","end_minute");