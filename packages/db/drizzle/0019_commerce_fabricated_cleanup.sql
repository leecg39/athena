-- Earlier commerce code invented "captured" sponsored ads and shopping products. Remove them.
-- 1) The fixed ad-copy templates of the old capture routine (no real capture produced these).
DELETE FROM "ads_impressions"
WHERE "ad_text" LIKE '[Sponsored] Try % AI Design & Prototyping — Free 30-day Enterprise trial for product teams (%)'
   OR "ad_text" LIKE '[Sponsored · AI Mode] % Teams — Generate brand-safe visual assets and templates 5x faster with AI'
   OR "ad_text" LIKE '[Sponsored · AI Overview] % for Business — Commercially safe generative AI design workflows'
   OR "ad_text" LIKE '[Sponsored] % (%) — Unified AI Design Canvas & Design Token Automation. Book a live demo.'
   OR "ad_text" LIKE '[Sponsored · AI Mode] Switch to % Dev Mode — Ship design tokens to production code in one click'
   OR "ad_text" LIKE '[Sponsored · AI Overview] Compare top collaborative design platforms — See why Fortune 500 teams standardize on %'
   OR "ad_text" LIKE '[Sponsored] % Innovation Workspace — Turn product specs into interactive wireframes automatically';
--> statement-breakpoint
-- 2) Products generated from templates rather than seen in answers.
DELETE FROM "shopping_products" sp
USING "websites" w
WHERE w."id" = sp."website_id"
  AND (
    sp."title" LIKE w."name" || ' AI Design Canvas Pro%'
    OR sp."title" LIKE w."name" || ' Collaborative Team Workspace%'
    OR sp."title" LIKE w."name" || ' Enterprise Design System Suite%'
    OR sp."title" LIKE 'Design Tokens Automation Engine%'
    OR sp."title" LIKE '% Professional Team Plan'
    OR sp."title" LIKE '% AI Studio & Templates'
    OR (sp."is_own" AND sp."price" = 24.00 AND sp."appearances" = 9 AND sp."avg_position" = 1.90)
  );
