CREATE INDEX IF NOT EXISTS "pitches_org_idx" ON "pitches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_group_idx" ON "saved_views" USING btree ("group_id","created_at");
