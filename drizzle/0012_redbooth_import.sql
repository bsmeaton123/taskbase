CREATE TABLE "redbooth_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"redbooth_name" text,
	"redbooth_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redbooth_imported_projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"import_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redbooth_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"started_by_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"progress" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "redbooth_connections" ADD CONSTRAINT "redbooth_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redbooth_imported_projects" ADD CONSTRAINT "redbooth_imported_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redbooth_imported_projects" ADD CONSTRAINT "redbooth_imported_projects_import_id_redbooth_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."redbooth_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redbooth_imports" ADD CONSTRAINT "redbooth_imports_started_by_id_user_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redbooth_imports_created_idx" ON "redbooth_imports" USING btree ("created_at");