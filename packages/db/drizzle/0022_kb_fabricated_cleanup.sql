-- Earlier knowledge-base code seeded generic baseline claims and auto-confirmed profile templates with invented /features URLs.
UPDATE "oracle_findings"
SET "fact_id" = NULL
WHERE "fact_id" IN (
  SELECT "id" FROM "kb_facts"
  WHERE "claim" LIKE '% provides AI-assisted workflows and real-time collaboration for teams.'
     OR "claim" LIKE '% Pro pricing starts at $29 per month and includes a free tier for small teams.'
     OR "claim" LIKE '% supports enterprise SSO, role-based access control, and workspace audit logs.'
);
--> statement-breakpoint
DELETE FROM "kb_facts"
WHERE "claim" LIKE '% provides AI-assisted workflows and real-time collaboration for teams.'
   OR "claim" LIKE '% Pro pricing starts at $29 per month and includes a free tier for small teams.'
   OR "claim" LIKE '% supports enterprise SSO, role-based access control, and workspace audit logs.';
--> statement-breakpoint
UPDATE "kb_facts"
SET "status" = 'pending_review', "source_url" = NULL
WHERE "source_url" LIKE '%/features'
  AND "status" = 'confirmed'
  -- the confidence values the earlier extraction wrote (user-entered facts are not touched)
  AND "confidence" IN (0.94, 0.95)
  AND ("claim" LIKE '% offers % for collaborative teams.' OR "claim" LIKE '% provides %.');
