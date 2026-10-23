-- Earlier content code seeded demo articles, fake catalog products and unencrypted CMS targets. Remove them.
-- 1) Child versions, drafts and briefs of seeded demo articles and fake catalog items without a real Shopify product ID.
DELETE FROM "content_versions"
WHERE "content_id" IN (
  SELECT "id" FROM "content_items"
  WHERE ("columns" ? 'citationsSeed')
     OR (("columns"->>'catalogProduct') = 'true' AND ("columns"->>'shopifyProductId') IS NULL)
);
--> statement-breakpoint
DELETE FROM "content_drafts"
WHERE "content_id" IN (
  SELECT "id" FROM "content_items"
  WHERE ("columns" ? 'citationsSeed')
     OR (("columns"->>'catalogProduct') = 'true' AND ("columns"->>'shopifyProductId') IS NULL)
);
--> statement-breakpoint
DELETE FROM "content_briefs"
WHERE "content_id" IN (
  SELECT "id" FROM "content_items"
  WHERE ("columns" ? 'citationsSeed')
     OR (("columns"->>'catalogProduct') = 'true' AND ("columns"->>'shopifyProductId') IS NULL)
);
--> statement-breakpoint
DELETE FROM "content_items"
WHERE ("columns" ? 'citationsSeed')
   OR (("columns"->>'catalogProduct') = 'true' AND ("columns"->>'shopifyProductId') IS NULL);
--> statement-breakpoint
-- 2) Export-only CMS targets or legacy targets without encrypted secrets.
DELETE FROM "publish_targets"
WHERE "provider" NOT IN ('wordpress', 'shopify')
   OR ("provider" = 'wordpress' AND COALESCE("config"->>'applicationPassword', '') NOT LIKE 'enc:%')
   OR ("provider" = 'shopify' AND COALESCE("config"->>'accessToken', '') NOT LIKE 'enc:%');
