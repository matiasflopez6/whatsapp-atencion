ALTER TABLE "google_calendar_configs" ADD COLUMN "account_email" text;--> statement-breakpoint
ALTER TABLE "google_calendar_configs" ADD COLUMN "status" text DEFAULT 'connected' NOT NULL;--> statement-breakpoint
ALTER TABLE "google_calendar_configs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_reason" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "locked_at" timestamp with time zone;