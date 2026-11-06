CREATE TABLE "app"."booking_counters" (
	"date" date PRIMARY KEY NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "booking_counter_range" CHECK ("app"."booking_counters"."value" BETWEEN 1 AND 999)
);
--> statement-breakpoint
CREATE TABLE "app"."booking_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_history_version" UNIQUE("booking_id","version")
);
--> statement-breakpoint
CREATE TABLE "app"."booking_services" (
	"booking_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	CONSTRAINT "booking_service" UNIQUE("booking_id","service_id"),
	CONSTRAINT "booking_service_values" CHECK ("app"."booking_services"."price" >= 0 AND "app"."booking_services"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"code" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"complaint" text NOT NULL,
	"vehicle_snapshot" jsonb NOT NULL,
	"estimated_total" integer NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_code_unique" UNIQUE("code"),
	CONSTRAINT "booking_customer_retry" UNIQUE("customer_id","idempotency_key"),
	CONSTRAINT "booking_id_owner" UNIQUE("id","customer_id"),
	CONSTRAINT "booking_values" CHECK ("app"."bookings"."code" ~ '^BK-[0-9]{8}-[0-9]{3}$' AND length(trim("app"."bookings"."complaint")) BETWEEN 1 AND 2000 AND "app"."bookings"."estimated_total" >= 0 AND "app"."bookings"."estimated_minutes" > 0 AND "app"."bookings"."version" > 0),
	CONSTRAINT "booking_status" CHECK ("app"."bookings"."status" IN ('confirmed','received','in_progress','completed','collected','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."tracking_tokens" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tracking_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "app"."notifications" ALTER COLUMN "challenge_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD COLUMN "booking_version" integer;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD COLUMN "kind" text DEFAULT 'otp' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD CONSTRAINT "booking_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."booking_services" ADD CONSTRAINT "booking_services_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."booking_services" ADD CONSTRAINT "booking_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "app"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "app"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tracking_tokens" ADD CONSTRAINT "tracking_tokens_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_customer_created" ON "app"."bookings" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_slot" ON "app"."bookings" USING btree ("slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_vehicle_slot_active" ON "app"."bookings" USING btree ("vehicle_id","slot_id") WHERE "app"."bookings"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "booking_notification_version" UNIQUE("booking_id","booking_version","kind");--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notification_target" CHECK (("app"."notifications"."kind" = 'otp' AND "app"."notifications"."challenge_id" IS NOT NULL AND "app"."notifications"."booking_id" IS NULL AND "app"."notifications"."booking_version" IS NULL AND "app"."notifications"."scheduled_at" IS NULL) OR ("app"."notifications"."kind" IN ('confirmation','reminder') AND "app"."notifications"."challenge_id" IS NULL AND "app"."notifications"."booking_id" IS NOT NULL AND "app"."notifications"."booking_version" > 0 AND "app"."notifications"."scheduled_at" IS NOT NULL));