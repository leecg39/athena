/**
 * Re-run extraction over stored answers (after competitors/attributes change or
 * extractor improvements). Recomputes mentions, position, sentiment, attribute
 * observations and brand-citation flags; provider citations are kept as stored.
 */
import { and, eq, gte, isNull, inArray, type SQL } from "drizzle-orm";
import { type Db, responses, responseMentions, responseCitations, attributeObservations, websites, competitors, attributes } from "@athena/db";
import { extract, isBrandDomain, lockExtractedData } from "@athena/core/extract";
import { normalizeUrl, rootDomainOf } from "@athena/core/sources";
import { generateInsightsForSite } from "@athena/core/insights";

interface SiteContext {
  site: typeof websites.$inferSelect;
  comps: (typeof competitors.$inferSelect)[];
  attrs: (typeof attributes.$inferSelect)[];
}

/**
 * Batches of one website run one at a time, and each reads the competitor set
 * under that lock: a pass that started before a competitor change can never
 * overwrite answers already re-analysed with the newer set.
 */
async function lockSite(tx: Db, websiteId: string): Promise<SiteContext | null> {
  await lockExtractedData(tx, websiteId);
  const [site] = await tx.select().from(websites).where(eq(websites.id, websiteId));
  if (!site) return null;
  const comps = await tx.select().from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt)));
  const attrs = await tx.select().from(attributes).where(eq(attributes.websiteId, site.id));
  return { site, comps, attrs };
}

async function reanalyzeOne(tx: Db, ctx: SiteContext, r: { id: string; rawText: string }, citedDomains: string[]) {
  const { site, comps, attrs } = ctx;
  const attrIds = new Map(attrs.map((a) => [a.name, a.id]));
  const ex = extract({
    rawText: r.rawText,
    brandName: site.name,
    brandDomain: site.domain,
    competitors: comps.map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
    attributes: attrs.map((a) => a.name),
  });
  const cited = citedDomains.some((d) => isBrandDomain(d, site.domain));
  await tx.update(responses).set({ mentioned: ex.mentioned, cited, position: ex.position, sentiment: ex.sentiment, shoppingCard: ex.shoppingCard }).where(eq(responses.id, r.id));
  await tx.delete(responseMentions).where(eq(responseMentions.responseId, r.id));
  if (ex.mentions.length) {
    await tx.insert(responseMentions).values(ex.mentions.map((m) => ({ responseId: r.id, competitorId: m.competitorId, name: m.name, sentiment: m.sentiment, position: m.position })));
  }
  await tx.delete(attributeObservations).where(eq(attributeObservations.responseId, r.id));
  const obs = ex.observations.filter((o) => attrIds.has(o.attribute));
  if (obs.length) {
    await tx.insert(attributeObservations).values(
      obs.map((o) => ({ attributeId: attrIds.get(o.attribute)!, responseId: r.id, competitorId: o.competitorId, textSpan: o.textSpan, score: o.score.toFixed(2), positive: o.positive })),
    );
  }
}

async function reanalyzeBatch(db: Db, websiteId: string, ids: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const ctx = await lockSite(tx, websiteId);
    if (!ctx) return;
    const batch = await tx.select({ id: responses.id, rawText: responses.rawText }).from(responses).where(inArray(responses.id, ids));
    const cites = await tx
      .select({ id: responseCitations.id, responseId: responseCitations.responseId, domain: responseCitations.domain })
      .from(responseCitations)
      .where(inArray(responseCitations.responseId, ids));
    for (const r of batch) {
      await reanalyzeOne(tx, ctx, r, cites.filter((c) => c.responseId === r.id).map((c) => c.domain));
    }
    // brand flag on stored citations follows the (possibly changed) brand domain
    const brandIds = cites.filter((c) => isBrandDomain(c.domain, ctx.site.domain)).map((c) => c.id);
    await tx.update(responseCitations).set({ isBrand: false }).where(inArray(responseCitations.responseId, ids));
    if (brandIds.length) await tx.update(responseCitations).set({ isBrand: true }).where(inArray(responseCitations.id, brandIds));
  });
}

/**
 * Re-run extraction over stored answers. Response ids are listed up front; the
 * text and the competitor/attribute sets are loaded per batch (bounded memory,
 * always the latest committed configuration).
 */
export async function reanalyzeResponses(db: Db, input: { websiteId: string; since?: Date; batchSize?: number }): Promise<number> {
  const conds: SQL[] = [eq(responses.websiteId, input.websiteId)];
  if (input.since) conds.push(gte(responses.ranAt, input.since));
  const rows = await db.select({ id: responses.id }).from(responses).where(and(...conds)).orderBy(responses.id);
  const size = input.batchSize ?? 50;
  for (let i = 0; i < rows.length; i += size) {
    await reanalyzeBatch(db, input.websiteId, rows.slice(i, i + size).map((r) => r.id));
  }
  if (rows.length > 0) {
    try {
      await generateInsightsForSite(db, { websiteId: input.websiteId });
    } catch (err) {
      console.warn("[insights] post-reanalyze refresh failed", input.websiteId, err instanceof Error ? err.message : err);
    }
  }
  return rows.length;
}

/** Fill root_domain / normalized_url for citations stored before those columns existed. */
export async function backfillCitationColumns(db: Db, batchSize = 500): Promise<number> {
  let updated = 0;
  for (;;) {
    const rows = await db
      .select({ id: responseCitations.id, url: responseCitations.url, domain: responseCitations.domain })
      .from(responseCitations)
      .where(isNull(responseCitations.rootDomain))
      .limit(batchSize);
    if (!rows.length) return updated;
    await db.transaction(async (tx) => {
      for (const r of rows) {
        await tx
          .update(responseCitations)
          .set({ rootDomain: rootDomainOf(r.domain), normalizedUrl: normalizeUrl(r.url) })
          .where(eq(responseCitations.id, r.id));
      }
    });
    updated += rows.length;
  }
}
