/**
 * Server-side data access: queries the database when reachable and falls
 * back to the deterministic demo dataset otherwise, so every screen has
 * real data bindings and still renders in keyless/local environments.
 */
import { db, competitors } from "@athena/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  demoCompetitorSoV,
  demoAds,
  demoShopping,
  demoActivity,
  demoOutreach,
} from "./demo";

export { demoAds, demoShopping, demoCompetitorSoV, demoActivity, demoOutreach };

/** Competitors tracked for one website (tenant-scoped). */
export async function getCompetitorList(websiteId: string): Promise<{ id: string; domain: string; name: string }[]> {
  const rows = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.websiteId, websiteId), isNull(competitors.deletedAt)))
    .orderBy(competitors.createdAt, competitors.id);
  return rows.map((r) => ({ id: r.id, domain: r.domain, name: r.name }));
}
