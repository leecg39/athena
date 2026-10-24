/**
 * Report data from collected AI answers only. Rates are null when no answers
 * were collected in the period; nothing is padded with sample values.
 */
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { type Db, contentBriefs, contentItems, prompts, responseCitations, responses, siteHealthPages } from "@athena/db";
import type { WebsiteRow } from "../tenancy";
import { visibilityForSite, searchValueForSite } from "../analytics/visibility";
import { periodDays, type PublicReportData, type ScheduledReportItem } from "./catalog";

const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

type ReportMeta = Pick<ScheduledReportItem, "id" | "shareId" | "name" | "reportType" | "cadence" | "charts">;
type Site = Pick<WebsiteRow, "id" | "name" | "domain" | "timezone">;

async function topSources(db: Db, site: Site, from: Date, to: Date) {
  const rows = await db
    .select({ domain: responseCitations.domain, isBrand: sql<boolean>`bool_or(${responseCitations.isBrand})`, n: sql<number>`count(*)::int` })
    .from(responseCitations)
    .innerJoin(responses, eq(responses.id, responseCitations.responseId))
    .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, from), lt(responses.ranAt, to)))
    .groupBy(responseCitations.domain)
    .orderBy(desc(sql`count(*)`), responseCitations.domain)
    .limit(8);
  return rows.map((r) => ({ domain: r.domain, citations: Number(r.n), isOwn: Boolean(r.isBrand) }));
}

/** Tracked prompts whose answers mention the brand in at most half of the answers. */
async function promptGaps(db: Db, site: Site, from: Date, to: Date) {
  const rows = await db
    .select({ text: prompts.text, volume: prompts.volumeEstimate, n: sql<number>`count(*)::int`, mentioned: sql<number>`count(*) filter (where ${responses.mentioned})::int` })
    .from(responses)
    .innerJoin(prompts, and(eq(prompts.id, responses.promptId), isNull(prompts.deletedAt)))
    .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, from), lt(responses.ranAt, to)))
    .groupBy(prompts.id, prompts.text, prompts.volumeEstimate);
  return rows
    .map((r) => ({ prompt: r.text, answers: Number(r.n), mentionRatePct: pct(Number(r.mentioned), Number(r.n)), volume: r.volume && r.volume > 0 ? r.volume : null }))
    .filter((r) => r.mentionRatePct <= 50)
    .sort((a, b) => a.mentionRatePct - b.mentionRatePct || (b.volume ?? 0) - (a.volume ?? 0) || b.answers - a.answers)
    .slice(0, 5);
}

async function contentPipeline(db: Db, site: Site) {
  const rows = await db
    .select({ id: contentItems.id, title: contentItems.title, status: contentItems.status, targetUrl: contentItems.targetUrl, columns: contentItems.columns, brief: contentBriefs.body })
    .from(contentItems)
    .leftJoin(contentBriefs, eq(contentBriefs.contentId, contentItems.id))
    .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
    .orderBy(desc(contentItems.createdAt))
    .limit(20);
  const editorial = rows.filter((r) => (r.columns ?? {}).catalogProduct !== true);
  const unique = [...new Map(editorial.map((r) => [r.id, r])).values()].slice(0, 6);
  return unique.map((r) => ({ id: r.id, title: r.title, status: r.status, targetUrl: r.targetUrl, summary: (r.brief ?? "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 180) }));
}

async function crawlerSummary(db: Db, site: Site) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${siteHealthPages.aiAccessible})::int`, last: sql<string | null>`max(${siteHealthPages.lastCheckedAt})::text` })
    .from(siteHealthPages)
    .where(and(eq(siteHealthPages.websiteId, site.id), sql`${siteHealthPages.lastCheckedAt} is not null`));
  const n = Number(row?.n ?? 0);
  return { pagesChecked: n, aiAccessiblePct: n ? pct(Number(row?.ok ?? 0), n) : null, checkedAt: n && row?.last ? new Date(row.last).toISOString() : null };
}

export async function buildReportData(db: Db, site: Site, meta: ReportMeta, now = new Date()): Promise<PublicReportData> {
  const days = periodDays(meta.cadence);
  const from = new Date(now.getTime() - days * DAY);
  const filters = { from, to: now };
  const [visibility, value, sources, gaps, proposals, crawler, [promptCount]] = await Promise.all([
    visibilityForSite(db, site, filters),
    searchValueForSite(db, site, filters),
    topSources(db, site, from, now),
    promptGaps(db, site, from, now),
    contentPipeline(db, site),
    crawlerSummary(db, site),
    db.select({ n: sql<number>`count(*)::int` }).from(prompts).where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt))),
  ]);
  const t = visibility.totals;
  const has = t.responses > 0;
  return {
    id: meta.id,
    shareId: meta.shareId,
    name: meta.name,
    reportType: meta.reportType,
    brandName: site.name,
    brandDomain: site.domain,
    cadence: meta.cadence,
    charts: meta.charts,
    generatedAt: now.toISOString(),
    period: { from: from.toISOString(), to: now.toISOString(), days },
    kpis: {
      responses: t.responses,
      mentionRatePct: has ? t.mentionRate : null,
      citationRatePct: has ? t.citationRate : null,
      shareOfVoicePct: has ? t.shareOfVoice : null,
      avgPosition: has ? t.avgPosition : null,
      simulatedSharePct: t.simulatedShare,
      activePrompts: Number(promptCount?.n ?? 0),
    },
    searchValue: value,
    daily: visibility.daily.map((d) => ({ date: d.date, responses: d.responses, mentionRatePct: d.mentionRate, citationRatePct: d.citationRate })),
    competitorSov: has ? visibility.entities.slice(0, 6).map((e) => ({ name: e.name, isOwn: e.competitorId === null, mentions: e.mentions, sovPct: e.shareOfVoice })) : [],
    topSources: sources,
    promptGaps: gaps,
    contentProposals: proposals,
    crawler,
  };
}
