-- Earlier versions stored records that described things that never happened (R3 review). Make them honest.
-- 1) Content marked "published" to a CMS although no request was ever sent.
UPDATE "content_items"
SET "status" = 'review',
    "columns" = ("columns" - 'publishedProvider' - 'publishedUrl' - 'publishedAt' - 'publishedVersion') || '{"agentStage": "revised"}'::jsonb
WHERE "deleted_at" IS NULL
  AND "status" = 'published'
  AND "columns" ? 'publishedProvider'
  AND NOT ("columns" ? 'remoteId')
  AND NOT ("columns" ? 'verifiedLiveAt');
--> statement-breakpoint
-- 2) Report schedules seeded on page view; "last sent" dates (nothing was ever delivered); invented default recipients.
DELETE FROM "scheduled_reports" r
USING "websites" w
WHERE w."id" = r."website_id"
  AND r."slack_channel" IN ('#aeo-executive', '#content-pipeline')
  AND (r."name" = w."name" || ' Executive AI Search Weekly' OR r."name" = w."name" || ' Content Proposal & Prompt Gap Deck');
--> statement-breakpoint
UPDATE "scheduled_reports" r
SET "last_sent_at" = NULL,
    "recipients" = COALESCE((
      SELECT jsonb_agg(e)
      FROM jsonb_array_elements_text(r."recipients") AS e
      WHERE e NOT IN (
        SELECT p || '@' || w."domain"
        FROM "websites" w, unnest(ARRAY['leadership', 'marketing', 'exec', 'growth', 'content']) AS p
        WHERE w."id" = r."website_id"
      )
    ), '[]'::jsonb);
--> statement-breakpoint
-- 3) Pitches whose numbers were derived from a hash of the URL (no measured answers).
DELETE FROM "pitches" WHERE ("payload"->>'version') IS DISTINCT FROM '2';
--> statement-breakpoint
-- 4) Credits granted without a payment (plan upgrades, packs, add-on bonuses, the group pool seed):
--    reverse what is still unspent, with a ledger entry per pool.
WITH fake AS (
  SELECT "organization_id", "website_id", "group_id", SUM("amount")::int AS "total"
  FROM "credit_ledger"
  WHERE "kind" = 'grant'
    AND ("reason" LIKE '% plan (%) monthly credit grant (+%'
      OR "reason" LIKE '% purchased → %'
      OR "reason" LIKE '% activated (+% bonus credits)'
      OR "reason" = 'Initial shared group credit pool allocation')
  GROUP BY 1, 2, 3
), target AS (
  SELECT DISTINCT ON (b."organization_id", b."website_id", b."group_id")
    b."id", b."organization_id", b."website_id", b."group_id", LEAST(f."total", b."balance") AS "amount"
  FROM fake f
  JOIN "credit_balances" b
    ON b."organization_id" = f."organization_id"
   AND b."website_id" IS NOT DISTINCT FROM f."website_id"
   AND b."group_id" IS NOT DISTINCT FROM f."group_id"
  ORDER BY b."organization_id", b."website_id", b."group_id", b."balance" DESC
), debited AS (
  UPDATE "credit_balances" c
  SET "balance" = c."balance" - t."amount", "updated_at" = now()
  FROM target t
  WHERE c."id" = t."id" AND t."amount" > 0
  RETURNING c."id"
)
INSERT INTO "credit_ledger" ("organization_id", "website_id", "group_id", "kind", "amount", "reason")
SELECT t."organization_id", t."website_id", t."group_id", 'adjustment', -t."amount", 'Reversed: credits granted without a payment by an earlier version'
FROM target t
WHERE t."amount" > 0;
--> statement-breakpoint
-- 5) Invoices recorded as paid although nothing was charged (invented Stripe ids).
UPDATE "invoices"
SET "status" = 'void',
    "amount_cents" = 0,
    "description" = 'Not charged (no payment was taken): ' || COALESCE("description", '')
WHERE "stripe_invoice_id" ~ '^in_(plan|pack|addon)_[0-9a-f]{16}$';
--> statement-breakpoint
-- 6) Plans and add-ons switched on without a payment (invented Stripe customer / subscription ids).
UPDATE "organizations" o
SET "plan" = 'free'
FROM "subscriptions" s
WHERE s."organization_id" = o."id"
  AND (s."stripe_subscription_id" ~ '^sub_[0-9a-f]{12}$' OR s."stripe_customer_id" ~ '^cus_[0-9a-f]{8}$');
--> statement-breakpoint
UPDATE "subscriptions"
SET "plan" = 'free', "status" = 'active', "monthly_credits" = 300, "addons" = '[]'::jsonb,
    "stripe_subscription_id" = NULL, "stripe_customer_id" = NULL, "current_period_end" = NULL
WHERE "stripe_subscription_id" ~ '^sub_[0-9a-f]{12}$' OR "stripe_customer_id" ~ '^cus_[0-9a-f]{8}$';
--> statement-breakpoint
UPDATE "subscriptions" SET "addons" = '[]'::jsonb WHERE "stripe_subscription_id" IS NULL AND "addons" <> '[]'::jsonb;
--> statement-breakpoint
-- 7) Facts an earlier extraction marked "confirmed" with the homepage as their source.
UPDATE "kb_facts" f
SET "status" = 'pending_review', "source_url" = NULL
FROM "websites" w
WHERE w."id" = f."website_id"
  AND f."status" = 'confirmed'
  AND f."source_url" = 'https://' || w."domain" || '/'
  AND ((f."confidence" = 0.98 AND f."claim" = btrim(w."profile"->>'description'))
    OR (f."confidence" = 0.96 AND f."claim" LIKE w."name" || ' is designed for %.'));
--> statement-breakpoint
-- 8) Open Oracle findings that rest on unconfirmed facts or on the old "not mentioned = contradiction" rule.
DELETE FROM "oracle_findings" o
WHERE o."status" = 'open'
  AND o."type" IN ('confirmed_inaccuracy', 'kb_inconsistency')
  AND (o."evidence" LIKE '% without mentioning % contradicts verified KB fact %'
    OR EXISTS (SELECT 1 FROM "kb_facts" f WHERE f."id" = o."fact_id" AND f."status" <> 'confirmed'));
