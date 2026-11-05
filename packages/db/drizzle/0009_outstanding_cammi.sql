CREATE TABLE "app"."work_order_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_changes_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "work_order_change_version" UNIQUE("work_order_id","version"),
	CONSTRAINT "work_order_change_values" CHECK ("app"."work_order_changes"."version" > 1 AND "app"."work_order_changes"."action" IN ('save','start','complete','rotate_tracking','revoke_tracking') AND length(trim("app"."work_order_changes"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_lines" (
	"work_order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	CONSTRAINT "work_order_line_position" UNIQUE("work_order_id","position"),
	CONSTRAINT "work_order_line_values" CHECK ("app"."work_order_lines"."position" BETWEEN 0 AND 99 AND "app"."work_order_lines"."kind" IN ('service','part') AND ("app"."work_order_lines"."kind"='service')=("app"."work_order_lines"."service_id" IS NOT NULL) AND length(trim("app"."work_order_lines"."description")) BETWEEN 1 AND 200 AND "app"."work_order_lines"."quantity" BETWEEN 1 AND 999 AND "app"."work_order_lines"."unit_price" BETWEEN 0 AND 2147483647 AND "app"."work_order_lines"."quantity"::bigint*"app"."work_order_lines"."unit_price" <= 2147483647)
);
--> statement-breakpoint
ALTER TABLE "app"."notifications" DROP CONSTRAINT "notification_target";--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "actor_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD COLUMN "estimate" jsonb;--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD COLUMN "diagnosis" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD COLUMN "inspection" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."work_order_changes" ADD CONSTRAINT "work_order_changes_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_changes" ADD CONSTRAINT "work_order_changes_actor_id_admins_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_lines" ADD CONSTRAINT "work_order_lines_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_lines" ADD CONSTRAINT "work_order_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."booking_history" ADD CONSTRAINT "booking_history_actor_id_admins_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD CONSTRAINT "work_orders_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notification_target" CHECK (("app"."notifications"."kind" = 'otp' AND "app"."notifications"."challenge_id" IS NOT NULL AND "app"."notifications"."booking_id" IS NULL AND "app"."notifications"."booking_version" IS NULL AND "app"."notifications"."scheduled_at" IS NULL) OR ("app"."notifications"."kind" IN ('confirmation','reminder','received','in_progress','completed') AND "app"."notifications"."challenge_id" IS NULL AND "app"."notifications"."booking_id" IS NOT NULL AND "app"."notifications"."booking_version" IS NOT NULL AND "app"."notifications"."booking_version" > 0 AND "app"."notifications"."scheduled_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "app"."work_orders" ADD CONSTRAINT "work_order_notes" CHECK (length("app"."work_orders"."diagnosis") <= 2000 AND length("app"."work_orders"."inspection") <= 2000 AND length("app"."work_orders"."notes") <= 4000);--> statement-breakpoint
UPDATE app.work_orders SET updated_by=received_by,updated_at=received_at;
--> statement-breakpoint
UPDATE app.booking_history h SET actor_id=w.received_by FROM app.work_orders w WHERE h.booking_id=w.booking_id AND h.action='received';
--> statement-breakpoint
INSERT INTO app.work_order_lines(work_order_id,position,kind,service_id,description,quantity,unit_price)
SELECT w.id,(row_number() OVER(PARTITION BY w.id ORDER BY bs.service_id)-1)::int,'service',bs.service_id,bs.name,1,bs.price
FROM app.work_orders w JOIN app.booking_services bs ON bs.booking_id=w.booking_id;
