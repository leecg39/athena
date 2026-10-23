-- Earlier site-health code seeded invented pages, status codes, keyword volumes and verification hashes. Remove them.
DELETE FROM "site_health_pages"
WHERE "meta"->>'verificationHash' IN ('sha256-core-home-v1', 'sha256-core-pricing-v1')
   OR "meta"->>'verificationHash' LIKE 'sha256-kb-%'
   OR "meta"->>'verificationHash' LIKE 'sha256-content-%'
   OR "url" LIKE '%/old/features-legacy'
   OR "url" LIKE '%/blog/ai-design-tools-2026'
   OR "url" LIKE '%/docs/api';
