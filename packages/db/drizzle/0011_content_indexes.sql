CREATE INDEX "content_briefs_content_idx" ON "content_briefs" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_drafts_content_idx" ON "content_drafts" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_items_ws_idx" ON "content_items" USING btree ("website_id","created_at");--> statement-breakpoint
CREATE INDEX "content_versions_content_idx" ON "content_versions" USING btree ("content_id","version");--> statement-breakpoint
CREATE INDEX "publish_targets_ws_provider_idx" ON "publish_targets" USING btree ("website_id","provider");