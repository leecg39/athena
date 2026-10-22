/**
 * Periodic & event-driven insight generation across all active websites.
 */
import { and, eq, gte, isNull } from "drizzle-orm";
import { type Db, websites, organizations, responses } from "@athena/db";
import { generateInsights } from "@athena/core/insights";

const DAY = 86_400_000;

export interface BatchInsightsSummary {
  websites: number;
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Evaluate and persist proactive AI insights for every active website that has
 * collected responses in the lookback window.
 */
export async function generateAllInsights(
  db: Db,
  opts: { days?: number; now?: Date } = {},
): Promise<BatchInsightsSummary> {
  const days = opts.days ?? 30;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * DAY);

  const activeSites = await db
    .selectDistinct({ id: websites.id })
    .from(websites)
    .innerJoin(organizations, and(eq(organizations.id, websites.organizationId), isNull(organizations.deletedAt)))
    .innerJoin(responses, and(eq(responses.websiteId, websites.id), gte(responses.ranAt, since)))
    .where(isNull(websites.deletedAt));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const s of activeSites) {
    try {
      const r = await generateInsights(db, { websiteId: s.id, days, now });
      created += r.created;
      updated += r.updated;
      skipped += r.skipped;
    } catch (err) {
      console.warn("[insights] failed for website", s.id, err instanceof Error ? err.message : err);
    }
  }

  return { websites: activeSites.length, created, updated, skipped };
}
