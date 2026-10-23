/**
 * Outreach discovery from stored citations only: a page becomes an opportunity
 * when AI answers actually cite it. Rates and reach are computed from those
 * answers — nothing is invented, padded or clamped.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { type Db, outreachOpportunities, websites, responses, responseCitations, prompts } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DAY, normalizeDomain, parseExternalOutreachUrl } from "./shared";

/** pages considered per discovery run (most cited first) */
const MAX_PAGES = 40;
/** citation rows read per run; enough for months of answers on one website */
const MAX_CITATION_ROWS = 50_000;

export interface PageStats {
  /** answers citing the page */
  citations: number;
  /** % of all answers in the window citing the page */
  citationPct: number;
  /** monthly search volume of the distinct prompts whose answers cite the page */
  estimatedImpressions: number;
}

interface CitedPage {
  url: string;
  domain: string;
  answers: Set<string>;
  volumes: Map<string, number>;
}

/** Third-party pages cited by this website's answers since `since`, keyed by normalised URL. */
export async function citedPages(db: Db, site: Pick<WebsiteRow, "id" | "domain">, since: Date): Promise<{ pages: Map<string, CitedPage>; totalAnswers: number }> {
  const [[total], rows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(responses).where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, since))),
    db
      .select({ url: responseCitations.url, responseId: responses.id, promptId: responses.promptId, volume: prompts.volumeEstimate })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .leftJoin(prompts, eq(prompts.id, responses.promptId))
      .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, since), eq(responseCitations.isBrand, false)))
      .limit(MAX_CITATION_ROWS),
  ]);
  const pages = new Map<string, CitedPage>();
  for (const row of rows) {
    let page: { url: string; domain: string };
    try {
      page = parseExternalOutreachUrl(row.url, normalizeDomain(site.domain));
    } catch {
      continue; // own site, unsafe or malformed URL
    }
    const entry = pages.get(page.url) ?? { ...page, answers: new Set<string>(), volumes: new Map<string, number>() };
    entry.answers.add(row.responseId);
    if (row.promptId) entry.volumes.set(row.promptId, row.volume ?? 0);
    pages.set(page.url, entry);
  }
  return { pages, totalAnswers: total?.n ?? 0 };
}

export function statsOf(page: CitedPage | undefined, totalAnswers: number): PageStats {
  if (!page || !totalAnswers) return { citations: 0, citationPct: 0, estimatedImpressions: 0 };
  return {
    citations: page.answers.size,
    citationPct: Math.round((page.answers.size / totalAnswers) * 10_000) / 100,
    estimatedImpressions: [...page.volumes.values()].reduce((s, v) => s + v, 0),
  };
}

/** Real stats for one URL over the last 30 days (zeros when no answer cites it). */
export async function statsForUrl(db: Db, site: Pick<WebsiteRow, "id" | "domain">, url: string, now = new Date()): Promise<PageStats> {
  const { pages, totalAnswers } = await citedPages(db, site, new Date(now.getTime() - 30 * DAY));
  return statsOf(pages.get(url), totalAnswers);
}

/**
 * Discovery for a website the caller has ALREADY authorised (collection jobs).
 * Users go through discoverOutreachOpportunities.
 */
export async function discoverOutreachForSite(db: Db, site: WebsiteRow, opts: { days?: number; actorId?: string } = {}): Promise<{ created: number; updated: number }> {
  const days = Math.min(90, Math.max(7, opts.days ?? 30));
  const { pages, totalAnswers } = await citedPages(db, site, new Date(Date.now() - days * DAY));
  const ranked = [...pages.values()].sort((a, b) => b.answers.size - a.answers.size || a.url.localeCompare(b.url)).slice(0, MAX_PAGES);
  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx.select().from(outreachOpportunities).where(eq(outreachOpportunities.websiteId, site.id));
    const byUrl = new Map(existing.map((r) => [r.url.toLowerCase(), r]));
    let created = 0;
    let updated = 0;
    for (const page of ranked) {
      const s = statsOf(page, totalAnswers);
      const values = { citations: s.citations, citationPct: s.citationPct.toFixed(2), estimatedImpressions: s.estimatedImpressions };
      const match = byUrl.get(page.url.toLowerCase());
      if (match) {
        await tx.update(outreachOpportunities).set(values).where(eq(outreachOpportunities.id, match.id));
        updated++;
      } else {
        await tx.insert(outreachOpportunities).values({ websiteId: site.id, url: page.url, domain: page.domain, status: "new", ...values });
        created++;
      }
    }
    if (opts.actorId && (created || updated)) {
      await logActivity(tx, { organizationId: site.organizationId, userId: opts.actorId, websiteId: site.id, entityType: "outreach_opportunity", change: "discovered", after: { created, updated } });
    }
    return { created, updated };
  });
}

export async function discoverOutreachOpportunities(db: Db, input: { actorId: string; websiteId: string; days?: number }): Promise<{ created: number; updated: number }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  return discoverOutreachForSite(db, site, { days: input.days, actorId: input.actorId });
}

