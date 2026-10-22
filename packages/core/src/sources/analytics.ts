/** Source analytics: domain ranking, domain detail, URL inspector, Sankey, overrides. */
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { type Db, responses, prompts, responseCitations, responseMentions, competitors, sourceOverrides } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { conditions, filtersSchema, type VisibilityFilters } from "../analytics/filters";
import { classifySource, normalizePattern, normalizeUrl, rootDomainOf, SOURCE_TYPES, type ClassifyContext, type SourceType } from "./url";

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const rootExpr = sql<string>`coalesce(${responseCitations.rootDomain}, ${responseCitations.domain})`;
const pageExpr = sql<string>`coalesce(${responseCitations.normalizedUrl}, ${responseCitations.url})`;

async function classifyContext(db: Db, site: WebsiteRow): Promise<ClassifyContext> {
  const [comps, overrides] = await Promise.all([
    db.select({ domain: competitors.domain }).from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt))),
    db.select({ pattern: sourceOverrides.pattern, type: sourceOverrides.type }).from(sourceOverrides).where(eq(sourceOverrides.websiteId, site.id)),
  ]);
  return { websiteDomain: site.domain, competitorDomains: comps.map((c) => c.domain), overrides: overrides.map((o) => ({ pattern: o.pattern, type: o.type as SourceType })) };
}

function dayExpr(tz: string) {
  return sql<string>`to_char((${responses.ranAt} at time zone ${tz})::date, 'YYYY-MM-DD')`;
}

const competitorMentioned = sql`exists (select 1 from ${responseMentions} where ${responseMentions.responseId} = ${responses.id} and ${responseMentions.competitorId} is not null)`;

export interface SourceRow {
  rootDomain: string;
  type: SourceType;
  responses: number;
  citationPct: number;
  brandMentionPct: number;
  competitorMentionPct: number;
  firstSeen: string;
  /** daily citation % aligned with `days` */
  spark: number[];
}

async function setup(db: Db, input: { actorId: string; websiteId: string; filters: VisibilityFilters }) {
  const f = filtersSchema.parse(input.filters);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return { f, site, where: and(...conditions(site.id, f)) as SQL, day: dayExpr(site.timezone) };
}

async function dailyTotals(db: Db, where: SQL, day: ReturnType<typeof dayExpr>) {
  return db
    .select({ date: day, n: sql<number>`count(*)::int` })
    .from(responses)
    .innerJoin(prompts, eq(prompts.id, responses.promptId))
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

export interface SourceListOptions {
  filters: VisibilityFilters;
  type?: SourceType;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listSources(
  db: Db,
  input: { actorId: string; websiteId: string } & SourceListOptions,
): Promise<{ rows: SourceRow[]; total: number; days: string[]; totalResponses: number }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return listSourcesForSite(db, site, input);
}

/** Source ranking for a website the caller has ALREADY authorised (API keys). */
export async function listSourcesForSite(
  db: Db,
  site: WebsiteRow,
  input: SourceListOptions,
): Promise<{ rows: SourceRow[]; total: number; days: string[]; totalResponses: number }> {
  const f = filtersSchema.parse(input.filters);
  const where = and(...conditions(site.id, f)) as SQL;
  const day = dayExpr(site.timezone);
  const [ctx, perDay, agg] = await Promise.all([
    classifyContext(db, site),
    dailyTotals(db, where, day),
    db
      .select({
        root: rootExpr,
        n: sql<number>`count(distinct ${responses.id})::int`,
        brand: sql<number>`count(distinct ${responses.id}) filter (where ${responses.mentioned})::int`,
        comp: sql<number>`count(distinct ${responses.id}) filter (where ${competitorMentioned})::int`,
        first: sql<string>`min(${day})`,
      })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(sql`1`),
  ]);
  const totalResponses = perDay.reduce((s, d) => s + d.n, 0);
  const q = input.q?.trim().toLowerCase();
  const all = agg
    .map((a) => ({ ...a, type: classifySource(`https://${a.root}/`, ctx) }))
    .filter((a) => (!input.type || a.type === input.type) && (!q || a.root.includes(q)))
    .sort((a, b) => b.n - a.n || a.root.localeCompare(b.root));
  const offset = input.offset ?? 0;
  const page = all.slice(offset, offset + Math.min(input.limit ?? 50, 500));
  const days = perDay.map((d) => d.date);
  const sparkRows = page.length
    ? await db
        .select({ root: rootExpr, date: day, n: sql<number>`count(distinct ${responses.id})::int` })
        .from(responseCitations)
        .innerJoin(responses, eq(responses.id, responseCitations.responseId))
        .innerJoin(prompts, eq(prompts.id, responses.promptId))
        .where(and(where, inArray(rootExpr, page.map((p) => p.root))))
        .groupBy(sql`1`, sql`2`)
    : [];
  const dayTotal = new Map(perDay.map((d) => [d.date, d.n]));
  return {
    rows: page.map((a) => ({
      rootDomain: a.root,
      type: a.type,
      responses: a.n,
      citationPct: pct(a.n, totalResponses),
      brandMentionPct: pct(a.brand, a.n),
      competitorMentionPct: pct(a.comp, a.n),
      firstSeen: a.first,
      spark: days.map((d) => pct(sparkRows.find((s) => s.root === a.root && s.date === d)?.n ?? 0, dayTotal.get(d) ?? 0)),
    })),
    total: all.length,
    days,
    totalResponses,
  };
}

export interface SourceDetail {
  rootDomain: string;
  type: SourceType;
  totalResponses: number;
  trend: { date: string; citationPct: number; responses: number }[];
  pages: { url: string; responses: number }[];
  prompts: { promptId: string; text: string; responses: number }[];
  competitors: { competitorId: string; name: string; responses: number }[];
  responses: { id: string; ranAt: Date; model: string; promptText: string; mentioned: boolean }[];
}

export async function sourceDetail(db: Db, input: { actorId: string; websiteId: string; rootDomain: string; filters: VisibilityFilters }): Promise<SourceDetail> {
  const { site, where, day } = await setup(db, input);
  const root = rootDomainOf(input.rootDomain);
  const citing = and(where, eq(rootExpr, root)) as SQL;
  const [ctx, perDay, trend, pages, promptRows, compRows, respRows] = await Promise.all([
    classifyContext(db, site),
    dailyTotals(db, where, day),
    db
      .select({ date: day, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ url: pageExpr, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing)
      .groupBy(sql`1`)
      .orderBy(desc(sql`2`), asc(sql`1`))
      .limit(200),
    db
      .select({ promptId: prompts.id, text: prompts.text, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing)
      .groupBy(prompts.id, prompts.text)
      .orderBy(desc(sql`3`))
      .limit(100),
    db
      .select({ competitorId: competitors.id, name: competitors.name, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .innerJoin(responseMentions, eq(responseMentions.responseId, responses.id))
      .innerJoin(competitors, eq(competitors.id, responseMentions.competitorId))
      .where(citing)
      .groupBy(competitors.id, competitors.name)
      .orderBy(desc(sql`3`)),
    db
      .selectDistinct({ id: responses.id, ranAt: responses.ranAt, model: responses.model, promptText: prompts.text, mentioned: responses.mentioned })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing)
      .orderBy(desc(responses.ranAt))
      .limit(100),
  ]);
  const dayTotal = new Map(perDay.map((d) => [d.date, d.n]));
  return {
    rootDomain: root,
    type: classifySource(`https://${root}/`, ctx),
    totalResponses: perDay.reduce((s, d) => s + d.n, 0),
    trend: trend.map((t) => ({ date: t.date, responses: t.n, citationPct: pct(t.n, dayTotal.get(t.date) ?? 0) })),
    pages: pages.map((p) => ({ url: p.url, responses: p.n })),
    prompts: promptRows.map((p) => ({ promptId: p.promptId, text: p.text, responses: p.n })),
    competitors: compRows.map((c) => ({ competitorId: c.competitorId, name: c.name, responses: c.n })),
    responses: respRows,
  };
}

export interface UrlInspection {
  normalizedUrl: string;
  type: SourceType;
  totalResponses: number;
  byModel: { model: string; responses: number }[];
  trend: { date: string; responses: number }[];
  variants: string[];
  responses: { id: string; ranAt: Date; model: string; promptText: string; mentioned: boolean }[];
}

export async function urlInspector(db: Db, input: { actorId: string; websiteId: string; url: string; filters: VisibilityFilters }): Promise<UrlInspection> {
  const normalized = normalizeUrl(input.url);
  if (!normalized) throw new DomainError("Enter a valid http(s) URL");
  const { site, where, day } = await setup(db, input);
  const citing = and(where, eq(pageExpr, normalized)) as SQL;
  const [ctx, total, byModel, trend, variants, respRows] = await Promise.all([
    classifyContext(db, site),
    db
      .select({ n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing),
    db
      .select({ model: responses.model, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing)
      .groupBy(responses.model)
      .orderBy(asc(responses.model)),
    db
      .select({ date: day, n: sql<number>`count(distinct ${responses.id})::int` })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .selectDistinct({ url: responseCitations.url })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing),
    db
      .selectDistinct({ id: responses.id, ranAt: responses.ranAt, model: responses.model, promptText: prompts.text, mentioned: responses.mentioned })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(citing)
      .orderBy(desc(responses.ranAt))
      .limit(100),
  ]);
  return {
    normalizedUrl: normalized,
    type: classifySource(normalized, ctx),
    totalResponses: total[0]?.n ?? 0,
    byModel: byModel.map((m) => ({ model: m.model, responses: m.n })),
    trend: trend.map((t) => ({ date: t.date, responses: t.n })),
    variants: variants.map((v) => v.url),
    responses: respRows,
  };
}

export interface Sankey {
  nodes: { name: string; kind: "source" | "brand" | "competitor" }[];
  links: { source: number; target: number; value: number }[];
}

/** Top sources → brands mentioned in the answers that cite them. */
export async function sourceSankey(db: Db, input: { actorId: string; websiteId: string; filters: VisibilityFilters; limit?: number }): Promise<Sankey> {
  const { site, where } = await setup(db, input);
  const top = await db
    .select({ root: rootExpr, n: sql<number>`count(distinct ${responses.id})::int` })
    .from(responseCitations)
    .innerJoin(responses, eq(responses.id, responseCitations.responseId))
    .innerJoin(prompts, eq(prompts.id, responses.promptId))
    .where(where)
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`), asc(sql`1`))
    .limit(Math.min(input.limit ?? 10, 30));
  if (!top.length) return { nodes: [], links: [] };
  const flows = await db
    .select({ root: rootExpr, competitorId: responseMentions.competitorId, name: responseMentions.name, n: sql<number>`count(distinct ${responses.id})::int` })
    .from(responseCitations)
    .innerJoin(responses, eq(responses.id, responseCitations.responseId))
    .innerJoin(prompts, eq(prompts.id, responses.promptId))
    .innerJoin(responseMentions, eq(responseMentions.responseId, responses.id))
    .where(and(where, inArray(rootExpr, top.map((t) => t.root))))
    .groupBy(sql`1`, sql`2`, sql`3`);
  const comps = new Map((await db.select({ id: competitors.id, name: competitors.name }).from(competitors).where(eq(competitors.websiteId, site.id))).map((c) => [c.id, c.name]));
  const nodes: Sankey["nodes"] = top.map((t) => ({ name: t.root, kind: "source" as const }));
  const entityIndex = new Map<string, number>();
  const links: Sankey["links"] = [];
  for (const f of flows) {
    const key = f.competitorId ?? "brand";
    const name = f.competitorId ? comps.get(f.competitorId) ?? f.name : site.name;
    if (!entityIndex.has(key)) {
      entityIndex.set(key, nodes.length);
      nodes.push({ name, kind: f.competitorId ? "competitor" : "brand" });
    }
    links.push({ source: top.findIndex((t) => t.root === f.root), target: entityIndex.get(key)!, value: f.n });
  }
  return { nodes, links };
}

/* ---------------- overrides ---------------- */

export async function listSourceOverrides(db: Db, input: { actorId: string; websiteId: string }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return db.select().from(sourceOverrides).where(eq(sourceOverrides.websiteId, site.id)).orderBy(asc(sourceOverrides.pattern));
}

export async function setSourceOverride(db: Db, input: { actorId: string; websiteId: string; pattern: string; type: string }) {
  const type = z.enum(SOURCE_TYPES as [SourceType, ...SourceType[]]).parse(input.type);
  const pattern = normalizePattern(input.pattern);
  if (!pattern) throw new DomainError("Enter a domain (example.com) or URL prefix (example.com/path)");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    await tx
      .insert(sourceOverrides)
      .values({ websiteId: site.id, pattern, type })
      .onConflictDoUpdate({ target: [sourceOverrides.websiteId, sourceOverrides.pattern], set: { type } });
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "source_type", change: "set", after: { pattern, type } });
  });
}

export async function removeSourceOverride(db: Db, input: { actorId: string; websiteId: string; pattern: string }) {
  const pattern = normalizePattern(input.pattern);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(sourceOverrides)
      .where(and(eq(sourceOverrides.websiteId, site.id), eq(sourceOverrides.pattern, pattern ?? "")))
      .returning();
    if (!row) throw new NotFoundError("Override not found");
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "source_type", change: "removed", before: { pattern: row.pattern, type: row.type } });
  });
}
