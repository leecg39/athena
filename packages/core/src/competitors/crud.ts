/** Competitor management (tenant-scoped, validated, audited). */
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { type Db, competitors, responseMentions, attributeObservations } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { normalizeCompetitorDomain } from "../onboarding";
import { lockExtractedData } from "../extract/lock";
import { MAX_COMPETITORS, TOO_MANY_COMPETITORS, competitorConflict, lockLiveCompetitors } from "./rules";

const id = z.string().uuid();
const name = z.string().trim().min(1).max(80);

export async function createCompetitor(db: Db, input: { actorId: string; websiteId: string; name: string; domain: string }) {
  const data = z.object({ actorId: id, websiteId: id, name, domain: z.string().max(300) }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  const entry = { name: data.name, domain: normalizeCompetitorDomain(data.domain) };
  return db.transaction(async (tx) => {
    const live = await lockLiveCompetitors(tx, site.id);
    if (live.length >= MAX_COMPETITORS) throw new DomainError(TOO_MANY_COMPETITORS);
    const conflict = competitorConflict(site, live, entry);
    if (conflict) throw new DomainError(conflict);
    const [row] = await tx.insert(competitors).values({ websiteId: site.id, ...entry }).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "competitor", entityId: row.id, change: "created", after: entry });
    return row;
  });
}

export async function updateCompetitor(db: Db, input: { actorId: string; websiteId: string; competitorId: string; name?: string; domain?: string }) {
  const data = z.object({ actorId: id, websiteId: id, competitorId: id, name: name.optional(), domain: z.string().max(300).optional() }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  const nextDomain = data.domain !== undefined ? normalizeCompetitorDomain(data.domain) : undefined;
  return db.transaction(async (tx) => {
    const live = await lockLiveCompetitors(tx, site.id);
    const before = live.find((c) => c.id === data.competitorId);
    if (!before) throw new NotFoundError("Competitor not found");
    const next = { name: data.name ?? before.name, domain: nextDomain ?? before.domain };
    if (next.name === before.name && next.domain === before.domain) return { competitor: before, changed: false };
    const conflict = competitorConflict(site, live.filter((c) => c.id !== before.id), next);
    if (conflict) throw new DomainError(conflict);
    const [row] = await tx.update(competitors).set(next).where(eq(competitors.id, before.id)).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "competitor", entityId: row.id, change: "updated", before: { name: before.name, domain: before.domain }, after: next });
    return { competitor: row, changed: true };
  });
}

export async function deleteCompetitor(db: Db, input: { actorId: string; websiteId: string; competitorId: string }) {
  const data = z.object({ actorId: id, websiteId: id, competitorId: id }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(competitors)
      .set({ deletedAt: new Date() })
      .where(and(eq(competitors.id, data.competitorId), eq(competitors.websiteId, site.id), isNull(competitors.deletedAt)))
      .returning();
    if (!row) throw new NotFoundError("Competitor not found");
    // drop its extracted data now so every metric excludes it before re-analysis finishes
    await lockExtractedData(tx, site.id);
    await tx.delete(responseMentions).where(eq(responseMentions.competitorId, row.id));
    await tx.delete(attributeObservations).where(eq(attributeObservations.competitorId, row.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "competitor", entityId: row.id, change: "deleted", before: { name: row.name, domain: row.domain } });
  });
}
