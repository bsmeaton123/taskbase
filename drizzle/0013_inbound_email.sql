CREATE TABLE "inbound_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"workspace_id" text,
	"sender_email" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "inbound_key" text DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24) NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_emails_workspace_idx" ON "inbound_emails" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_inbound_key_unique" UNIQUE("inbound_key");