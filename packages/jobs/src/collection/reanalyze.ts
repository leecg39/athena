/**
 * Re-run extraction over stored answers (after competitors/attributes change or
 * extractor improvements). Recomputes mentions, position, sentiment, attribute
 * observations and brand-citation flags; provider citations are kept as stored.
 */
import { and, eq, gte, isNull, inArray, type SQL } from "drizzle-orm";
import { type Db, responses, responseMentions, responseCitations, attributeObservations, websites, competitors, attributes } from "@athena/db";
import { extract, isBrandDomain } from "@athena/core/extract";

export async function reanalyzeResponses(db: Db, input: { websiteId: string; since?: Date; batchSize?: number }): Promise<number> {
  const [site] = await db.select().from(websites).where(eq(websites.id, input.websiteId));
  if (!site) return 0;
  const comps = await db.select().from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt)));
  const attrs = await db.select().from(attributes).where(eq(attributes.websiteId, site.id));
  const attrIds = new Map(attrs.map((a) => [a.name, a.id]));
  const conds: SQL[] = [eq(responses.websiteId, site.id)];
  if (input.since) conds.push(gte(responses.ranAt, input.since));
  const rows = await db.select({ id: responses.id, rawText: responses.rawText }).from(responses).where(and(...conds));
  const size = input.batchSize ?? 50;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const cites = await db
      .select({ responseId: responseCitations.responseId, domain: responseCitations.domain })
      .from(responseCitations)
      .where(inArray(responseCitations.responseId, batch.map((b) => b.id)));
    await db.transaction(async (tx) => {
      for (const r of batch) {
        const ex = extract({
          rawText: r.rawText,
          brandName: site.name,
          brandDomain: site.domain,
          competitors: comps.map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
          attributes: attrs.map((a) => a.name),
        });
        const cited = cites.some((c) => c.responseId === r.id && isBrandDomain(c.domain, site.domain));
        await tx.update(responses).set({ mentioned: ex.mentioned, cited, position: ex.position, sentiment: ex.sentiment, shoppingCard: ex.shoppingCard }).where(eq(responses.id, r.id));
        await tx.update(responseCitations).set({ isBrand: false }).where(eq(responseCitations.responseId, r.id));
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
      // brand flag on stored citations follows the (possibly changed) brand domain
      const ids = batch.map((b) => b.id);
      const all = await tx.select({ id: responseCitations.id, domain: responseCitations.domain }).from(responseCitations).where(inArray(responseCitations.responseId, ids));
      const brandIds = all.filter((c) => isBrandDomain(c.domain, site.domain)).map((c) => c.id);
      if (brandIds.length) await tx.update(responseCitations).set({ isBrand: true }).where(inArray(responseCitations.id, brandIds));
    });
  }
  return rows.length;
}
