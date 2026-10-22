import { sql } from "drizzle-orm";
import type { Db } from "@athena/db";

/**
 * Serialises writes to one website's extracted answer data (mentions, attribute
 * observations, derived response columns). Taken first, before any row lock, by
 * re-analysis batches and competitor deletion so the two never deadlock.
 */
export async function lockExtractedData(tx: Db, websiteId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reanalyze:${websiteId}`}, 0))`);
}
