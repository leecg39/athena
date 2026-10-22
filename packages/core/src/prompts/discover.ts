/**
 * Prompt discovery: candidate prompts from real search demand (Search Console),
 * competitor gaps in collected AI answers, and site/product context.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { type Db, responses, responseMentions, competitors } from "@athena/db";

export type DiscoverySource = "search_console" | "competitor_gap" | "site" | "template";

export interface PromptCandidate {
  text: string;
  source: DiscoverySource;
  /** impressions (search console) or gap responses (competitor gap); 0 when unknown */
  volume: number;
}

const QUESTION_START = /^(how|what|which|why|who|where|when|is|are|can|does|do|should|best|top|cheapest|alternatives?)\b/i;

export function candidatesFromSearchConsole(
  rows: { query: string; impressions: number; clicks: number }[],
  tracked: Set<string>,
  max = 30,
): PromptCandidate[] {
  return rows
    .map((r) => ({ ...r, query: r.query.trim().replace(/\s+/g, " ") }))
    .filter((r) => {
      const words = r.query.split(" ").length;
      return (words >= 4 || (words >= 3 && QUESTION_START.test(r.query))) && !tracked.has(r.query.toLowerCase());
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, max)
    .map((r) => ({ text: r.query, source: "search_console" as const, volume: r.impressions }));
}

/** Competitors that appear in answers where the brand is absent → comparison/alternative prompts. */
export async function competitorGapCandidates(
  db: Db,
  opts: { websiteId: string; brandName: string; tracked: Set<string>; days?: number; maxCompetitors?: number },
): Promise<PromptCandidate[]> {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const gaps = await db
    .select({ name: competitors.name, gapResponses: sql<number>`count(distinct ${responses.id})::int` })
    .from(responses)
    .innerJoin(responseMentions, eq(responseMentions.responseId, responses.id))
    .innerJoin(competitors, eq(competitors.id, responseMentions.competitorId))
    .where(and(eq(responses.websiteId, opts.websiteId), eq(responses.mentioned, false), gte(responses.ranAt, since)))
    .groupBy(competitors.name)
    .orderBy(desc(sql`count(distinct ${responses.id})`))
    .limit(opts.maxCompetitors ?? 5);
  const out: PromptCandidate[] = [];
  for (const g of gaps) {
    for (const text of [`${opts.brandName} vs ${g.name}`, `best alternatives to ${g.name}`, `is ${g.name} worth it`]) {
      if (!opts.tracked.has(text.toLowerCase())) out.push({ text, source: "competitor_gap", volume: g.gapResponses });
    }
  }
  return out;
}

/** Merge candidate lists: case-insensitive de-duplication keeping the highest-volume entry. */
export function mergeCandidates(lists: PromptCandidate[][], max = 60): PromptCandidate[] {
  const best = new Map<string, PromptCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const key = c.text.toLowerCase();
      const prev = best.get(key);
      if (!prev || c.volume > prev.volume) best.set(key, c);
    }
  }
  return [...best.values()].sort((a, b) => b.volume - a.volume).slice(0, max);
}
