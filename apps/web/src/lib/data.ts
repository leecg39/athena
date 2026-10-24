/** Server-side data access helpers. */
import { db, competitors } from "@athena/db";
import { and, eq, isNull } from "drizzle-orm";

/** Competitors tracked for one website (tenant-scoped). */
export async function getCompetitorList(websiteId: string): Promise<{ id: string; domain: string; name: string }[]> {
  const rows = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.websiteId, websiteId), isNull(competitors.deletedAt)))
    .orderBy(competitors.createdAt, competitors.id);
  return rows.map((r) => ({ id: r.id, domain: r.domain, name: r.name }));
}
