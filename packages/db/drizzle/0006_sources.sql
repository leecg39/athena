CREATE TABLE "source_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "response_citations" ADD COLUMN "root_domain" text;--> statement-breakpoint
ALTER TABLE "response_citations" ADD COLUMN "normalized_url" text;--> statement-breakpoint
ALTER TABLE "source_overrides" ADD CONSTRAINT "source_overrides_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_overrides_ws_pattern_idx" ON "source_overrides" USING btree ("website_id","pattern");--> statement-breakpoint
CREATE INDEX "citations_root_idx" ON "response_citations" USING btree ("root_domain");--> statement-breakpoint
CREATE INDEX "citations_norm_url_idx" ON "response_citations" USING btree ("normalized_url");