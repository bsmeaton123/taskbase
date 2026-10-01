ALTER TYPE "public"."activity_kind" ADD VALUE 'start_changed';--> statement-breakpoint
ALTER TYPE "public"."activity_kind" ADD VALUE 'recurrence_changed';--> statement-breakpoint
ALTER TYPE "public"."activity_kind" ADD VALUE 'recurred';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurred_from_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurred_from_id_tasks_id_fk" FOREIGN KEY ("recurred_from_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;