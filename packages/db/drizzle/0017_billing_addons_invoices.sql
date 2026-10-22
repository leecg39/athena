ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_interval" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "addons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_org_idx" ON "invoices" USING btree ("organization_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_stripe_id_idx" ON "invoices" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_org_idx" ON "subscriptions" USING btree ("organization_id","created_at");
