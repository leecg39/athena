/** Brand vs competitor visibility comparison, topic heatmap and competitor discovery. */
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { type Db, responses, prompts, topics, responseMentions, responseCitations, competitors } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { conditions, filtersSchema, type VisibilityFilters } from "../analytics/filters";
import { rootDomainOf } from "../sources/url";
import { aliasesFor } from "../extract/entities";

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const round1 = (v: number | null) => (v === null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
const rootExpr = sql<string>`coalesce(${responseCitations.rootDomain}, ${responseCitations.domain})`;

interface Entity {
  competitorId: string | null;
  name: string;
  domain: string;
  root: string;
}

async function prepare(db: Db, input: { actorId: string; websiteId: string; filters: VisibilityFilters }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return prepareForSite(db, site, input.filters);
}

async function prepareForSite(db: Db, site: WebsiteRow, filters: VisibilityFilters) {
  const f = filtersSchema.parse(filters);
  const comps = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt)))
    .orderBy(competitors.createdAt, competitors.id);
  const entities: Entity[] = [
    { competitorId: null, name: site.name, domain: site.domain, root: rootDomainOf(site.domain) },
    ...comps.map((c) => ({ competitorId: c.id, name: c.name, domain: c.domain, root: rootDomainOf(c.domain) })),
  ];
  return { site, entities, where: and(...conditions(site.id, f)) as SQL };
}

export interface EntityComparison {
  competitorId: string | null;
  name: string;
  domain: string;
  mentions: number;
  mentionRate: number;
  shareOfVoice: number;
  avgPosition: number | null;
  citationRate: number;
  sentiment: { positive: number; neutral: number; negative: number; mixed: number };
}

export async function compareEntities(
  db: Db,
  input: { actorId: string; websiteId: string; filters: VisibilityFilters },
): Promise<{ totalResponses: number; entities: EntityComparison[] }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return compareEntitiesForSite(db, site, input.filters);
}

export async function compareEntitiesForSite(
  db: Db,
  site: WebsiteRow,
  filters: VisibilityFilters,
): Promise<{ totalResponses: number; entities: EntityComparison[] }> {
  const { entities, where } = await prepareForSite(db, site, filters);
  const [[total], mentionRows, citeRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(responses).innerJoin(prompts, eq(prompts.id, responses.promptId)).where(where),
    db
      .select({
        competitorId: responseMentions.competitorId,
        n: sql<number>`count(distinct ${responseMentions.responseId})::int`,
        avgPos: sql<number | null>`avg(${responseMentions.position})::float`,
        pos: sql<number>`count(distinct ${responseMentions.responseId}) filter (where ${responseMentions.sentiment} = 'positive')::int`,
        neu: sql<number>`count(distinct ${responseMentions.responseId}) filter (where ${responseMentions.sentiment} = 'neutral')::int`,
        neg: sql<number>`count(distinct ${responseMentions.responseId}) filter (where ${responseMentions.sentiment} = 'negative')::int`,
        mix: sql<number>`count(distinct ${responseMentions.responseId}) filter (where ${responseMentions.sentiment} = 'mixed')::int`,
      })
      .from(responseMentions)
      .innerJoin(responses, eq(responses.id, responseMentions.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(responseMentions.competitorId),
    db
      .select({ root: rootExpr, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(and(where, inArray(rootExpr, entities.map((e) => e.root))))
      .groupBy(sql`1`),
  ]);
  const n = total?.n ?? 0;
  const allMentions = mentionRows.reduce((s, r) => s + r.n, 0);
  return {
    totalResponses: n,
    entities: entities.map((e) => {
      const m = mentionRows.find((r) => r.competitorId === e.competitorId);
      return {
        competitorId: e.competitorId,
        name: e.name,
        domain: e.domain,
        mentions: m?.n ?? 0,
        mentionRate: pct(m?.n ?? 0, n),
        shareOfVoice: pct(m?.n ?? 0, allMentions),
        avgPosition: round1(m?.avgPos ?? null),
        citationRate: pct(citeRows.find((c) => c.root === e.root)?.n ?? 0, n),
        sentiment: { positive: m?.pos ?? 0, neutral: m?.neu ?? 0, negative: m?.neg ?? 0, mixed: m?.mix ?? 0 },
      };
    }),
  };
}

export interface Heatmap {
  topics: { id: string | null; name: string; responses: number }[];
  entities: { competitorId: string | null; name: string }[];
  /** [topic][entity] % of the topic's answers mentioning the entity */
  mention: number[][];
  /** [topic][entity] % of the topic's answers citing the entity's domain */
  citation: number[][];
}

export async function topicHeatmap(db: Db, input: { actorId: string; websiteId: string; filters: VisibilityFilters }): Promise<Heatmap> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return topicHeatmapForSite(db, site, input.filters);
}

export async function topicHeatmapForSite(db: Db, site: WebsiteRow, filters: VisibilityFilters): Promise<Heatmap> {
  const { entities, where } = await prepareForSite(db, site, filters);
  const topicName = sql<string | null>`${topics.name}`;
  const [totals, mentionRows, citeRows] = await Promise.all([
    db
      .select({ topicId: prompts.topicId, name: topicName, n: sql<number>`count(*)::int` })
      .from(responses)
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .leftJoin(topics, and(eq(topics.id, prompts.topicId), isNull(topics.deletedAt)))
      .where(where)
      .groupBy(prompts.topicId, topics.name),
    db
      .select({ topicId: prompts.topicId, competitorId: responseMentions.competitorId, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseMentions)
      .innerJoin(responses, eq(responses.id, responseMentions.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(prompts.topicId, responseMentions.competitorId),
    db
      .select({ topicId: prompts.topicId, root: rootExpr, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(and(where, inArray(rootExpr, entities.map((e) => e.root))))
      .groupBy(prompts.topicId, sql`2`),
  ]);
  const topicList = totals
    .map((t) => ({ id: t.topicId, name: t.topicId ? t.name ?? "Deleted topic" : "No topic", responses: t.n }))
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
  const key = (topicId: string | null, other: string | null) => `${topicId ?? ""}|${other ?? ""}`;
  const mentionsBy = new Map(mentionRows.map((m) => [key(m.topicId, m.competitorId), m.n]));
  const citesBy = new Map(citeRows.map((c) => [key(c.topicId, c.root), c.n]));
  return {
    topics: topicList,
    entities: entities.map((e) => ({ competitorId: e.competitorId, name: e.name })),
    mention: topicList.map((t) => entities.map((e) => pct(mentionsBy.get(key(t.id, e.competitorId)) ?? 0, t.responses))),
    citation: topicList.map((t) => entities.map((e) => pct(citesBy.get(key(t.id, e.root)) ?? 0, t.responses))),
  };
}

/* ---------------- discovery ---------------- */

const LIST_LINE = /^[ \t]*(?:\d{1,2}[.)]|[-*•])[ \t]+(.+)$/gm;

/** Probable product/brand names from list items: bold lead or text before a separator. */
export function listItemTitles(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LIST_LINE)) {
    const line = m[1].trim();
    const bold = /^\*\*([^*]{1,60})\*\*/.exec(line);
    let title = bold ? bold[1] : line.split(/\s+[—–-]\s+|:\s|\s\(|,\s/)[0];
    title = title.replace(/[*_`]/g, "").replace(/[.:;,!?]+$/, "").trim();
    const words = title.split(/\s+/);
    if (!title || title.length > 40 || words.length > 4) continue;
    if (!/^[\p{Lu}\p{N}]/u.test(title)) continue;
    out.push(title);
  }
  return out;
}

const DISCOVERY_SCAN = { answers: 1000, chars: 16_000 } as const;

export interface CompetitorCandidate {
  name: string;
  responses: number;
  samplePrompt: string;
}

/** Brands that answers list repeatedly but you do not track yet. */
export async function discoverCompetitorCandidates(
  db: Db,
  input: { actorId: string; websiteId: string; filters: VisibilityFilters; minResponses?: number },
): Promise<CompetitorCandidate[]> {
  const { entities, where } = await prepare(db, input);
  // bounded per page view: the latest answers, and only their leading text (lists come early)
  const rows = await db
    .select({ id: responses.id, rawText: sql<string>`left(${responses.rawText}, ${DISCOVERY_SCAN.chars})`, prompt: prompts.text })
    .from(responses)
    .innerJoin(prompts, eq(prompts.id, responses.promptId))
    .where(where)
    .orderBy(desc(responses.ranAt))
    .limit(DISCOVERY_SCAN.answers);
  const tracked = new Set(entities.flatMap((e) => aliasesFor(e.name, e.domain).map((a) => a.toLowerCase())));
  const counts = new Map<string, { name: string; ids: Set<string>; prompt: string }>();
  for (const r of rows) {
    for (const title of new Set(listItemTitles(r.rawText))) {
      const key = title.toLowerCase();
      if (tracked.has(key)) continue;
      const entry = counts.get(key) ?? { name: title, ids: new Set<string>(), prompt: r.prompt };
      entry.ids.add(r.id);
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .filter((c) => c.ids.size >= (input.minResponses ?? 2))
    .sort((a, b) => b.ids.size - a.ids.size || a.name.localeCompare(b.name))
    .slice(0, 15)
    .map((c) => ({ name: c.name, responses: c.ids.size, samplePrompt: c.prompt }));
}

export type { WebsiteRow };
