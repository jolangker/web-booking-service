CREATE TABLE "app"."admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_username_unique" UNIQUE("username"),
	CONSTRAINT "admin_role" CHECK ("app"."admins"."role" = 'admin')
);
--> statement-breakpoint
CREATE TABLE "app"."calendar_exceptions" (
	"date" date PRIMARY KEY NOT NULL,
	"closed" boolean DEFAULT true NOT NULL,
	"quota" integer,
	"reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "exception_quota" CHECK ("app"."calendar_exceptions"."quota" IS NULL OR "app"."calendar_exceptions"."quota" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "app"."login_throttles" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"resets_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_values" CHECK (length(trim("app"."services"."name")) BETWEEN 1 AND 100 AND "app"."services"."price" >= 0 AND "app"."services"."duration_minutes" BETWEEN 1 AND 1440)
);
--> statement-breakpoint
CREATE TABLE "app"."slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"quota" integer NOT NULL,
	"quota_override" integer,
	"reserved" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "slot_date_start" UNIQUE("date","start_minute"),
	CONSTRAINT "slot_time" CHECK ("app"."slots"."start_minute" >= 0 AND "app"."slots"."start_minute" < "app"."slots"."end_minute" AND "app"."slots"."end_minute" <= 1440 AND "app"."slots"."starts_at" < "app"."slots"."ends_at"),
	CONSTRAINT "slot_capacity" CHECK ("app"."slots"."reserved" >= 0 AND "app"."slots"."quota" >= "app"."slots"."reserved" AND "app"."slots"."quota" <= 1000 AND ("app"."slots"."quota_override" IS NULL OR "app"."slots"."quota_override" BETWEEN 0 AND 1000) AND ("app"."slots"."active" OR "app"."slots"."reserved" = 0))
);
--> statement-breakpoint
CREATE TABLE "app"."weekly_hours" (
	"day" integer PRIMARY KEY NOT NULL,
	"open" jsonb NOT NULL,
	"breaks" jsonb NOT NULL,
	CONSTRAINT "weekday" CHECK ("app"."weekly_hours"."day" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "app"."workshop" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"slot_minutes" integer DEFAULT 60 NOT NULL,
	"default_quota" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "single_workshop" CHECK ("app"."workshop"."id" = 1 AND "app"."workshop"."timezone" = 'Asia/Jakarta'),
	CONSTRAINT "workshop_values" CHECK ("app"."workshop"."slot_minutes" BETWEEN 5 AND 240 AND "app"."workshop"."default_quota" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "app"."admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "app"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_session_expiry" ON "app"."admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "slot_date" ON "app"."slots" USING btree ("date");
--> statement-breakpoint
INSERT INTO "app"."workshop" (id) VALUES (1);
--> statement-breakpoint
INSERT INTO "app"."weekly_hours" (day, open, breaks)
SELECT day, '[]'::jsonb, '[]'::jsonb FROM generate_series(0,6) AS day;
