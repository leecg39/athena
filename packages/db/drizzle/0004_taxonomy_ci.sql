DROP INDEX "prompt_tags_ws_name_idx";--> statement-breakpoint
DROP INDEX "topics_ws_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_tags_ws_name_ci_idx" ON "prompt_tags" USING btree ("website_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "topics_ws_name_live_idx" ON "topics" USING btree ("website_id",lower("name")) WHERE "topics"."deleted_at" is null;