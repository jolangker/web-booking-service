CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."runtime_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue_job_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "runtime_jobs_queue_job_id_unique" UNIQUE("queue_job_id")
);
