ALTER TYPE "public"."activity_kind" ADD VALUE 'restored';--> statement-breakpoint
CREATE TABLE "trashed_blobs" (
	"attachment_id" text PRIMARY KEY NOT NULL,
	"trash_id" text NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trashed_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"list_name" text,
	"deleted_by_id" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "trashed_tasks_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
ALTER TABLE "trashed_blobs" ADD CONSTRAINT "trashed_blobs_trash_id_trashed_tasks_id_fk" FOREIGN KEY ("trash_id") REFERENCES "public"."trashed_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trashed_tasks" ADD CONSTRAINT "trashed_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trashed_tasks" ADD CONSTRAINT "trashed_tasks_deleted_by_id_user_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trashed_blobs_trash_idx" ON "trashed_blobs" USING btree ("trash_id");--> statement-breakpoint
CREATE INDEX "trashed_tasks_workspace_idx" ON "trashed_tasks" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE INDEX "trashed_tasks_number_idx" ON "trashed_tasks" USING btree ("number");--> statement-breakpoint
CREATE INDEX "trashed_tasks_deleted_idx" ON "trashed_tasks" USING btree ("deleted_at");