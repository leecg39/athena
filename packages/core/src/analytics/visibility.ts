/**
 * Visibility metrics over collected AI answers (Olympus / API):
 *  - mention rate  = % of answers mentioning the brand
 *  - citation rate = % of answers citing a brand-owned domain
 *  - avg position  = mean brand rank where mentioned (lower is better)
 *  - share of voice = brand mentions / all tracked-entity mentions (each entity once per answer)
 * Days are bucketed in the website's timezone.
 */
import { z } from "zod";
import { and, asc, eq, exists, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { type Db, responses, prompts, responseMentions, competitors, promptTagLinks } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";

export interface VisibilityFilters {
  from: Date;
  to: Date;
  models?: string[];
  topicIds?: string[];
  personaIds?: string[];
  locationIds?: string[];
  tagIds?: string[];
  promptIds?: string[];
  promptType?: "branded" | "non_branded";
}

const uuidList = z.array(z.string().uuid()).max(200).optional();
const filtersSchema = z
  .object({
    from: z.date(),
    to: z.date(),
    models: z.array(z.string().max(40)).max(20).optional(),
    topicIds: uuidList,
    personaIds: uuidList,
    locationIds: uuidList,
    tagIds: uuidList,
    promptIds: uuidList,
    promptType: z.enum(["branded", "non_branded"]).optional(),
  })
  .refine((f) => f.from < f.to, "from must be before to");

export interface VisibilityTotals {
  responses: number;
  mentionRate: number;
  citationRate: number;
  avgPosition: number | null;
  shareOfVoice: number;
  /** share of answers produced by the dev-only simulated provider */
  simulatedShare: number;
}

export interface DailyPoint {
  date: string;
  responses: number;
  mentionRate: number;
  citationRate: number;
  avgPosition: number | null;
  shareOfVoice: number;
}

export interface EntityShare {
  competitorId: string | null;
  name: string;
  mentions: number;
  mentionRate: number;
  shareOfVoice: number;
}

export interface DailyModelPoint {
  date: string;
  model: string;
  responses: number;
  mentionRate: number;
  citationRate: number;
  avgPosition: number | null;
}

export interface DailyEntityPoint {
  date: string;
  competitorId: string | null;
  name: string;
  shareOfVoice: number;
}

export interface VisibilityMetrics {
  totals: VisibilityTotals;
  daily: DailyPoint[];
  dailyByModel: DailyModelPoint[];
  dailyEntities: DailyEntityPoint[];
  byModel: { model: string; responses: number; mentionRate: number; citationRate: number; avgPosition: number | null }[];
  entities: EntityShare[];
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const round1 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

function conditions(websiteId: string, f: VisibilityFilters): SQL[] {
  const c: SQL[] = [eq(responses.websiteId, websiteId), gte(responses.ranAt, f.from), lt(responses.ranAt, f.to), isNull(prompts.deletedAt)];
  if (f.models?.length) c.push(inArray(responses.model, f.models));
  if (f.topicIds?.length) c.push(inArray(prompts.topicId, f.topicIds));
  if (f.personaIds?.length) c.push(inArray(prompts.personaId, f.personaIds));
  if (f.locationIds?.length) c.push(inArray(prompts.locationId, f.locationIds));
  if (f.promptIds?.length) c.push(inArray(prompts.id, f.promptIds));
  if (f.promptType) c.push(eq(prompts.type, f.promptType));
  if (f.tagIds?.length) {
    c.push(
      exists(
        sql`select 1 from ${promptTagLinks} where ${promptTagLinks.promptId} = ${prompts.id} and ${inArray(promptTagLinks.tagId, f.tagIds)}`,
      ),
    );
  }
  return c;
}

export async function getVisibilityMetrics(
  db: Db,
  input: { actorId: string; websiteId: string; filters: VisibilityFilters },
): Promise<VisibilityMetrics> {
  const f = filtersSchema.parse(input.filters);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  const where = and(...conditions(site.id, f));
  const day = sql<string>`to_char((${responses.ranAt} at time zone ${site.timezone})::date, 'YYYY-MM-DD')`;

  const [totalsRow, dailyRows, modelRows, entityRows, dailyEntityRows, comps, dailyModelRows, dailyPerEntity] = await Promise.all([
    db
      .select({
        n: sql<number>`count(*)::int`,
        mentioned: sql<number>`count(*) filter (where ${responses.mentioned})::int`,
        cited: sql<number>`count(*) filter (where ${responses.cited})::int`,
        avgPos: sql<number | null>`avg(${responses.position})::float`,
        simulated: sql<number>`count(*) filter (where ${responses.simulated})::int`,
      })
      .from(responses)
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where),
    db
      .select({
        date: day,
        n: sql<number>`count(*)::int`,
        mentioned: sql<number>`count(*) filter (where ${responses.mentioned})::int`,
        cited: sql<number>`count(*) filter (where ${responses.cited})::int`,
        avgPos: sql<number | null>`avg(${responses.position})::float`,
      })
      .from(responses)
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      // ordinal grouping: the bound timezone would otherwise appear as distinct placeholders
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        model: responses.model,
        n: sql<number>`count(*)::int`,
        mentioned: sql<number>`count(*) filter (where ${responses.mentioned})::int`,
        cited: sql<number>`count(*) filter (where ${responses.cited})::int`,
        avgPos: sql<number | null>`avg(${responses.position})::float`,
      })
      .from(responses)
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(responses.model)
      .orderBy(asc(responses.model)),
    db
      .select({ competitorId: responseMentions.competitorId, n: sql<number>`count(distinct ${responseMentions.responseId})::int` })
      .from(responseMentions)
      .innerJoin(responses, eq(responses.id, responseMentions.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(responseMentions.competitorId),
    db
      .select({
        date: day,
        brand: sql<number>`count(distinct ${responseMentions.responseId}) filter (where ${responseMentions.competitorId} is null)::int`,
        all: sql<number>`count(distinct (${responseMentions.responseId}::text || coalesce(${responseMentions.competitorId}::text, 'brand')))::int`,
      })
      .from(responseMentions)
      .innerJoin(responses, eq(responses.id, responseMentions.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(sql`1`),
    db.select({ id: competitors.id, name: competitors.name }).from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt))),
    db
      .select({
        date: day,
        model: responses.model,
        n: sql<number>`count(*)::int`,
        mentioned: sql<number>`count(*) filter (where ${responses.mentioned})::int`,
        cited: sql<number>`count(*) filter (where ${responses.cited})::int`,
        avgPos: sql<number | null>`avg(${responses.position})::float`,
      })
      .from(responses)
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(sql`1`, sql`2`)
      .orderBy(sql`1`, sql`2`),
    db
      .select({ date: day, competitorId: responseMentions.competitorId, n: sql<number>`count(distinct ${responseMentions.responseId})::int` })
      .from(responseMentions)
      .innerJoin(responses, eq(responses.id, responseMentions.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(sql`1`, sql`2`),
  ]);
  const compName = new Map(comps.map((c) => [c.id, c.name]));
  const dayTotal = new Map<string, number>();
  for (const r of dailyPerEntity) dayTotal.set(r.date, (dayTotal.get(r.date) ?? 0) + r.n);

  const t = totalsRow[0];
  const totalMentions = entityRows.reduce((s, r) => s + r.n, 0);
  const brandMentions = entityRows.find((r) => r.competitorId === null)?.n ?? 0;
  const sovByDay = new Map(dailyEntityRows.map((r) => [r.date, pct(r.brand, r.all)]));
  const entities: EntityShare[] = [
    { competitorId: null, name: site.name, mentions: brandMentions },
    ...comps.map((c) => ({ competitorId: c.id, name: c.name, mentions: entityRows.find((r) => r.competitorId === c.id)?.n ?? 0 })),
  ]
    .map((e) => ({ ...e, mentionRate: pct(e.mentions, t?.n ?? 0), shareOfVoice: pct(e.mentions, totalMentions) }))
    .sort((a, b) => (a.competitorId === null ? -1 : b.competitorId === null ? 1 : b.mentions - a.mentions || a.name.localeCompare(b.name)));

  return {
    totals: {
      responses: t?.n ?? 0,
      mentionRate: pct(t?.mentioned ?? 0, t?.n ?? 0),
      citationRate: pct(t?.cited ?? 0, t?.n ?? 0),
      avgPosition: round1(t?.avgPos),
      shareOfVoice: pct(brandMentions, totalMentions),
      simulatedShare: pct(t?.simulated ?? 0, t?.n ?? 0),
    },
    daily: dailyRows.map((d) => ({
      date: d.date,
      responses: d.n,
      mentionRate: pct(d.mentioned, d.n),
      citationRate: pct(d.cited, d.n),
      avgPosition: round1(d.avgPos),
      shareOfVoice: sovByDay.get(d.date) ?? 0,
    })),
    dailyByModel: dailyModelRows.map((d) => ({
      date: d.date,
      model: d.model,
      responses: d.n,
      mentionRate: pct(d.mentioned, d.n),
      citationRate: pct(d.cited, d.n),
      avgPosition: round1(d.avgPos),
    })),
    dailyEntities: dailyPerEntity
      .map((e) => ({
        date: e.date,
        competitorId: e.competitorId,
        name: e.competitorId === null ? site.name : compName.get(e.competitorId) ?? "Unknown",
        shareOfVoice: pct(e.n, dayTotal.get(e.date) ?? 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.competitorId === null ? -1 : b.competitorId === null ? 1 : b.shareOfVoice - a.shareOfVoice)),
    byModel: modelRows.map((m) => ({ model: m.model, responses: m.n, mentionRate: pct(m.mentioned, m.n), citationRate: pct(m.cited, m.n), avgPosition: round1(m.avgPos) })),
    entities,
  };
}

export interface SearchValue {
  /** at least one prompt carries a real search-volume estimate (e.g. Search Console impressions) */
  hasVolume: boolean;
  /** Σ prompt volume × share of that prompt's answers mentioning the brand */
  aiVisibleSearches: number;
  trackedVolume: number;
}

/** "AI search value" from real volume data only — never an invented per-response dollar figure. */
export async function getSearchValue(db: Db, input: { actorId: string; websiteId: string; filters: VisibilityFilters }): Promise<SearchValue> {
  const f = filtersSchema.parse(input.filters);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  const rows = await db
    .select({
      volume: prompts.volumeEstimate,
      n: sql<number>`count(*)::int`,
      mentioned: sql<number>`count(*) filter (where ${responses.mentioned})::int`,
    })
    .from(responses)
    .innerJoin(prompts, eq(prompts.id, responses.promptId))
    .where(and(...conditions(site.id, f), sql`${prompts.volumeEstimate} > 0`))
    .groupBy(prompts.id, prompts.volumeEstimate);
  if (!rows.length) return { hasVolume: false, aiVisibleSearches: 0, trackedVolume: 0 };
  return {
    hasVolume: true,
    aiVisibleSearches: Math.round(rows.reduce((s, r) => s + (r.volume ?? 0) * (r.n ? r.mentioned / r.n : 0), 0)),
    trackedVolume: rows.reduce((s, r) => s + (r.volume ?? 0), 0),
  };
}

export interface TotalsDelta {
  mentionRate: number;
  citationRate: number;
  shareOfVoice: number;
  avgPosition: number | null;
}

/** Point deltas vs the previous period (null when either period has no answers). */
export function compareTotals(current: VisibilityTotals, previous: VisibilityTotals): TotalsDelta | null {
  if (!current.responses || !previous.responses) return null;
  const d = (a: number, b: number) => Math.round((a - b) * 10) / 10;
  return {
    mentionRate: d(current.mentionRate, previous.mentionRate),
    citationRate: d(current.citationRate, previous.citationRate),
    shareOfVoice: d(current.shareOfVoice, previous.shareOfVoice),
    avgPosition: current.avgPosition !== null && previous.avgPosition !== null ? d(current.avgPosition, previous.avgPosition) : null,
  };
}
