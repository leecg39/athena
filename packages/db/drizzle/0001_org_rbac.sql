ALTER TABLE "invites" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tokenHash_unique" UNIQUE("token_hash");