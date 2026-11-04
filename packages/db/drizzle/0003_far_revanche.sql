CREATE TABLE "app"."customer_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"verified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_unique" UNIQUE("phone"),
	CONSTRAINT "customer_values" CHECK ("app"."customers"."phone" ~ '^[+]628[0-9]{8,11}$' AND length("app"."customers"."name") <= 100 AND "app"."customers"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer,
	"message_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "delivery_attempts_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "app"."delivery_events" (
	"message_id" text NOT NULL,
	"ack" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_event_dedup" UNIQUE("message_id","ack"),
	CONSTRAINT "delivery_ack" CHECK ("app"."delivery_events"."ack" BETWEEN -1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "app"."gateway_dispatch" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "single_gateway_dispatch" CHECK ("app"."gateway_dispatch"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"queue_job_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_challenge_id_unique" UNIQUE("challenge_id"),
	CONSTRAINT "notifications_queue_job_id_unique" UNIQUE("queue_job_id"),
	CONSTRAINT "notification_status" CHECK ("app"."notifications"."status" IN ('queued','retrying','sending','accepted','sent','delivered','read','failed','unknown','stale'))
);
--> statement-breakpoint
CREATE TABLE "app"."otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"purpose" text NOT NULL,
	"customer_id" uuid,
	"binding" text NOT NULL,
	"verifier" text,
	"ciphertext" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "otp_values" CHECK ("app"."otp_challenges"."purpose" IN ('login','contact') AND ("app"."otp_challenges"."purpose" = 'login' OR "app"."otp_challenges"."customer_id" IS NOT NULL) AND "app"."otp_challenges"."attempts" BETWEEN 0 AND 3 AND "app"."otp_challenges"."expires_at" <= "app"."otp_challenges"."created_at" + interval '5 minutes')
);
--> statement-breakpoint
CREATE TABLE "app"."vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate"),
	CONSTRAINT "vehicle_values" CHECK ("app"."vehicles"."plate" ~ '^[A-Z]{1,2}[0-9]{1,4}[A-Z]{0,3}$' AND length(trim("app"."vehicles"."brand")) BETWEEN 1 AND 60 AND length(trim("app"."vehicles"."model")) BETWEEN 1 AND 80 AND "app"."vehicles"."year" BETWEEN 1900 AND 2200 AND "app"."vehicles"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."delivery_attempts" ADD CONSTRAINT "delivery_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "app"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "app"."otp_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."otp_challenges" ADD CONSTRAINT "otp_challenges_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."vehicles" ADD CONSTRAINT "vehicles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_session_expiry" ON "app"."customer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "delivery_notification" ON "app"."delivery_attempts" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "otp_phone_created" ON "app"."otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "vehicle_owner" ON "app"."vehicles" USING btree ("customer_id");