ALTER TABLE "user" ADD COLUMN "daily_reminder" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "daily_reminder_sent_on" date;