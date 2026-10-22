/** Rules shared by every path that adds or edits tracked competitors. */
import { and, eq, isNull } from "drizzle-orm";
import { competitors } from "@athena/db";
import type { WebsiteRow } from "../tenancy";
import { lockWebsite, type Tx } from "../prompts/shared";
import { rootDomainOf } from "../sources/url";

/** Live competitors per website (each change re-analyses every stored answer). */
export const MAX_COMPETITORS = 50;

export const TOO_MANY_COMPETITORS = `You can track at most ${MAX_COMPETITORS} competitors per website`;

export interface CompetitorEntry {
  name: string;
  /** already normalised */
  domain: string;
}

/** Why `entry` cannot be tracked next to `live`, or null when it can. */
export function competitorConflict(site: Pick<WebsiteRow, "name" | "domain">, live: readonly CompetitorEntry[], entry: CompetitorEntry): string | null {
  const name = entry.name.trim().toLowerCase();
  if (rootDomainOf(entry.domain) === rootDomainOf(site.domain)) return "That is your own domain";
  if (name === site.name.trim().toLowerCase()) return "That is your own brand name";
  if (live.some((c) => c.domain === entry.domain)) return `${entry.domain} is already tracked`;
  const sameName = live.find((c) => c.name.trim().toLowerCase() === name);
  return sameName ? `A competitor named ${sameName.name} is already tracked` : null;
}

/** Locks the website row (serialising competitor writes) and returns its live competitors. */
export async function lockLiveCompetitors(tx: Tx, websiteId: string) {
  await lockWebsite(tx, websiteId);
  return tx
    .select()
    .from(competitors)
    .where(and(eq(competitors.websiteId, websiteId), isNull(competitors.deletedAt)))
    .orderBy(competitors.createdAt, competitors.id);
}
