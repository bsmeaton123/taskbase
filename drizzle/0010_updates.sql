CREATE TYPE "public"."update_item_kind" AS ENUM('activity', 'comment');--> statement-breakpoint
CREATE TABLE "update_dismissals" (
	"user_id" text NOT NULL,
	"item_kind" "update_item_kind" NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "update_dismissals_user_id_item_kind_item_id_pk" PRIMARY KEY("user_id","item_kind","item_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "updates_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "update_dismissals" ADD CONSTRAINT "update_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;