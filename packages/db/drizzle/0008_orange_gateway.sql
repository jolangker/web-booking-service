CREATE TABLE "app"."work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"odometer" integer NOT NULL,
	"initial_condition" text NOT NULL,
	"pit" text DEFAULT '' NOT NULL,
	"assignee" text DEFAULT '' NOT NULL,
	"origin" text NOT NULL,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "work_orders_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "work_orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "work_order_values" CHECK ("app"."work_orders"."odometer" BETWEEN 0 AND 9999999 AND length(trim("app"."work_orders"."initial_condition")) BETWEEN 1 AND 2000 AND length("app"."work_orders"."pit") <= 60 AND length("app"."work_orders"."assignee") <= 100 AND "app"."work_orders"."version" > 0 AND "app"."work_orders"."origin" IN ('online','walk_in'))
);
--> statement-breakpoint
ALTER TABLE "app"."notifications" DROP CONSTRAINT "notification_target";--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD CONSTRAINT "work_orders_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD CONSTRAINT "work_orders_received_by_admins_id_fk" FOREIGN KEY ("received_by") REFERENCES "app"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notification_target" CHECK (("app"."notifications"."kind" = 'otp' AND "app"."notifications"."challenge_id" IS NOT NULL AND "app"."notifications"."booking_id" IS NULL AND "app"."notifications"."booking_version" IS NULL AND "app"."notifications"."scheduled_at" IS NULL) OR ("app"."notifications"."kind" IN ('confirmation','reminder','received') AND "app"."notifications"."challenge_id" IS NULL AND "app"."notifications"."booking_id" IS NOT NULL AND "app"."notifications"."booking_version" IS NOT NULL AND "app"."notifications"."booking_version" > 0 AND "app"."notifications"."scheduled_at" IS NOT NULL));