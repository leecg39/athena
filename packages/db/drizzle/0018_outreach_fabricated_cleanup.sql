-- Earlier outreach code stored invented data. Remove it, keeping anything a user worked on.
-- 1) Contacts from the hard-coded "author directory" or a guessed editorial@<domain> address.
UPDATE "outreach_opportunities"
SET "author_name" = NULL, "author_email" = NULL
WHERE "author_email" IN (
    'research-editorial@g2.com', 'tips-enterprise@techcrunch.com', 'jordan.vance.editorial@medium.com',
    'mods-pm-wiki@reddit.com', 'editors-software@wikipedia.org', 'partnerships@devonpark.io',
    'cloud-desk@forbes.com', 'catalog-updates@capterra.com'
  )
  OR ("author_email" = 'editorial@' || "domain" AND ("author_name" LIKE '% Desk (%)' OR "author_name" LIKE 'Editorial Team (%)'));
--> statement-breakpoint
-- 2) Opportunities that were never cited (invented fallback pages and rewritten "article" URLs), if untouched.
DELETE FROM "outreach_opportunities"
WHERE "status" = 'new' AND "email_draft" IS NULL AND "notes" IS NULL
  AND "url" IN (
    'https://g2.com/categories/ai-design-tools',
    'https://techcrunch.com/2026/08/best-ai-design-platforms-for-product-teams',
    'https://medium.com/design-systems/comparing-ai-design-canvases-2026',
    'https://reddit.com/r/ProductManagement/comments/best_figma_alternatives',
    'https://capterra.com/collaborative-design-software/spotlight',
    'https://wikipedia.org/wiki/Collaborative_design_software',
    'https://youtube.com/watch?v=ai-design-tools-2026'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "response_citations" rc
    JOIN "responses" r ON r."id" = rc."response_id"
    WHERE r."website_id" = "outreach_opportunities"."website_id"
      AND rtrim(regexp_replace(rc."url", '^https?://(www\.)?', 'https://'), '/') = rtrim("outreach_opportunities"."url", '/')
  );
