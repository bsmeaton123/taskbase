CREATE TABLE "task_assignees" (
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignees_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" USING btree ("user_id");--> statement-breakpoint
-- Every task keeps the person it was assigned to, before the single-assignee column goes.
INSERT INTO "task_assignees" ("task_id", "user_id", "created_at")
SELECT "tasks"."id", "tasks"."assignee_id", "tasks"."created_at"
FROM "tasks"
JOIN "user" ON "user"."id" = "tasks"."assignee_id"
WHERE "tasks"."assignee_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assignee_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "tasks_assignee_idx";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "assignee_id";
