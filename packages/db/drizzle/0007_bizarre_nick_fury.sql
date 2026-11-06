ALTER TABLE "app"."bookings" DROP CONSTRAINT "booking_status";--> statement-breakpoint
DROP INDEX "app"."booking_vehicle_slot_active";--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "reservation_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "action" text DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
UPDATE app.booking_history h SET scheduled_at=b.scheduled_at FROM app.bookings b WHERE b.id=h.booking_id;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ALTER COLUMN "scheduled_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "previous_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "reservation_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
UPDATE app.bookings SET reservation_status='cancelled',status='confirmed',reminder_at=NULL WHERE status='cancelled';--> statement-breakpoint
UPDATE app.booking_history SET reservation_status='cancelled',status='confirmed',action='cancelled' WHERE status='cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "booking_vehicle_slot_active" ON "app"."bookings" USING btree ("vehicle_id","scheduled_at") WHERE "app"."bookings"."reservation_status" = 'active';--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD CONSTRAINT "booking_mutation_retry" UNIQUE("booking_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD CONSTRAINT "booking_history_reservation" CHECK ("app"."booking_history"."reservation_status" IN ('active','cancelled'));--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "booking_reservation_status" CHECK ("app"."bookings"."reservation_status" IN ('active','cancelled') AND ("app"."bookings"."reservation_status" <> 'cancelled' OR ("app"."bookings"."status" = 'confirmed' AND "app"."bookings"."checked_in_at" IS NULL)));--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "booking_status" CHECK ("app"."bookings"."status" IN ('confirmed','received','in_progress','completed','collected'));
