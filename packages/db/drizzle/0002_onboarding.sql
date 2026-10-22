ALTER TABLE "websites" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "websites" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_ws_domain_live_idx" ON "competitors" USING btree ("website_id","domain") WHERE "competitors"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_ws_name_live_idx" ON "locations" USING btree ("website_id",lower("name")) WHERE "locations"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "personas_ws_name_live_idx" ON "personas" USING btree ("website_id",lower("name")) WHERE "personas"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_ws_text_live_idx" ON "prompts" USING btree ("website_id",lower("text")) WHERE "prompts"."deleted_at" is null;