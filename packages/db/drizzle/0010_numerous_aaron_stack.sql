CREATE TABLE "app"."invoice_counters" (
	"date" date PRIMARY KEY NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "invoice_counter_range" CHECK ("app"."invoice_counters"."value" BETWEEN 1 AND 999999)
);
--> statement-breakpoint
CREATE TABLE "app"."invoice_lines" (
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	CONSTRAINT "invoice_line_position" UNIQUE("invoice_id","position"),
	CONSTRAINT "invoice_line_values" CHECK ("app"."invoice_lines"."position" BETWEEN 0 AND 99 AND "app"."invoice_lines"."kind" IN ('service','part') AND length(trim("app"."invoice_lines"."description")) BETWEEN 1 AND 200 AND "app"."invoice_lines"."quantity" BETWEEN 1 AND 999 AND "app"."invoice_lines"."unit_price">=0 AND "app"."invoice_lines"."quantity"::bigint*"app"."invoice_lines"."unit_price"<=2147483647)
);
--> statement-breakpoint
CREATE TABLE "app"."invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"number" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"queue_job_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"file_hash" text,
	"file_size" integer,
	"ready_at" timestamp with time zone,
	CONSTRAINT "invoices_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoice_number" CHECK ("app"."invoices"."number" ~ '^INV-[0-9]{8}-[0-9]{6}$'),
	CONSTRAINT "invoice_issuance" CHECK ("app"."invoices"."status" IN ('pending','ready','failed') AND "app"."invoices"."attempts">=0 AND ("app"."invoices"."status"<>'ready' OR ("app"."invoices"."file_hash" IS NOT NULL AND "app"."invoices"."file_size">0 AND "app"."invoices"."ready_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"method" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"total" integer NOT NULL,
	"received" integer NOT NULL,
	"change" integer NOT NULL,
	"paid_by" uuid NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "payments_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "payments_work_order_id_unique" UNIQUE("work_order_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payment_values" CHECK ("app"."payments"."status"='paid' AND "app"."payments"."total" BETWEEN 1 AND 2147483647 AND "app"."payments"."received" >= "app"."payments"."total" AND "app"."payments"."change"="app"."payments"."received"-"app"."payments"."total" AND (("app"."payments"."method"='cash' AND "app"."payments"."reference"='') OR ("app"."payments"."method" IN ('qris','edc') AND "app"."payments"."received"="app"."payments"."total" AND length(trim("app"."payments"."reference")) BETWEEN 1 AND 100)))
);
--> statement-breakpoint
CREATE TABLE "app"."service_archives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"archived_at" timestamp with time zone NOT NULL,
	CONSTRAINT "service_archives_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "service_archives_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
ALTER TABLE "app"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_paid_by_admins_id_fk" FOREIGN KEY ("paid_by") REFERENCES "app"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_archives" ADD CONSTRAINT "service_archives_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_archives" ADD CONSTRAINT "service_archives_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_archives" ADD CONSTRAINT "service_archives_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_archives" ADD CONSTRAINT "service_archives_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "app"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_archive_owner" ON "app"."service_archives" USING btree ("customer_id","vehicle_id","archived_at");
--> statement-breakpoint
CREATE FUNCTION app.reject_financial_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Paid financial records are immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON app.payments FOR EACH ROW EXECUTE FUNCTION app.reject_financial_mutation();
--> statement-breakpoint
CREATE TRIGGER archive_immutable BEFORE UPDATE OR DELETE ON app.service_archives FOR EACH ROW EXECUTE FUNCTION app.reject_financial_mutation();
--> statement-breakpoint
CREATE FUNCTION app.protect_invoice_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice is permanent' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.payment_id,NEW.number,NEW.snapshot) IS DISTINCT FROM ROW(OLD.id,OLD.payment_id,OLD.number,OLD.snapshot) THEN
    RAISE EXCEPTION 'Invoice snapshot is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_snapshot_immutable BEFORE UPDATE OR DELETE ON app.invoices FOR EACH ROW EXECUTE FUNCTION app.protect_invoice_snapshot();
--> statement-breakpoint
CREATE FUNCTION app.protect_invoice_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Invoice lines are immutable' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM app.service_archives WHERE invoice_id=NEW.invoice_id) THEN
    RAISE EXCEPTION 'Archived invoice lines are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.invoice_lines FOR EACH ROW EXECUTE FUNCTION app.protect_invoice_lines();
--> statement-breakpoint
CREATE FUNCTION app.protect_paid_work_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='work_orders' AND TG_OP='UPDATE'
    AND (to_jsonb(NEW)-'version'-'updated_by'-'updated_at')=(to_jsonb(OLD)-'version'-'updated_by'-'updated_at') THEN
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM app.payments WHERE work_order_id=CASE WHEN TG_TABLE_NAME='work_orders' THEN (to_jsonb(OLD)->>'id')::uuid ELSE (to_jsonb(OLD)->>'work_order_id')::uuid END
    OR work_order_id=(to_jsonb(NEW)->>'work_order_id')::uuid) THEN
    RAISE EXCEPTION 'Paid work order is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paid_work_order_immutable BEFORE UPDATE OR DELETE ON app.work_orders FOR EACH ROW EXECUTE FUNCTION app.protect_paid_work_order();
--> statement-breakpoint
CREATE TRIGGER paid_work_order_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON app.work_order_lines FOR EACH ROW EXECUTE FUNCTION app.protect_paid_work_order();
