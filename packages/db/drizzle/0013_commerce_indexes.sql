ALTER TABLE "ads_impressions" DROP CONSTRAINT "ads_impressions_prompt_id_prompts_id_fk";
--> statement-breakpoint
ALTER TABLE "ads_impressions" ADD CONSTRAINT "ads_impressions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ads_ws_surface_seen_idx" ON "ads_impressions" USING btree ("website_id","surface","seen_at");--> statement-breakpoint
CREATE INDEX "shopping_ws_own_idx" ON "shopping_products" USING btree ("website_id","is_own","appearances");