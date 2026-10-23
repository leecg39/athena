/** Outreach pipeline: listing, manual additions, author contacts and kanban moves. */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { type Db, outreachOpportunities, websites } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { authorFromHtml, type FoundAuthor } from "./author";
import { statsForUrl } from "./discover";
import {
  EMAIL_RE,
  MAX_OUTREACH_ITEMS,
  OUTREACH_STATUSES,
  lockedOpportunity,
  parseExternalOutreachUrl,
  toOpportunityRow,
  type OutreachListResult,
  type OutreachOpportunityRow,
  type OutreachStatus,
} from "./shared";

export async function listOutreachOpportunities(
  db: Db,
  rawInput: { actorId: string; websiteId: string; status?: OutreachStatus; domain?: string; search?: string },
): Promise<OutreachListResult> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:read");

  const allRows = await db
    .select()
    .from(outreachOpportunities)
    .where(eq(outreachOpportunities.websiteId, site.id))
    .orderBy(desc(outreachOpportunities.citations), desc(outreachOpportunities.estimatedImpressions), desc(outreachOpportunities.createdAt));

  const parsed = allRows.map(toOpportunityRow);
  const counts = {
    new: 0,
    todo: 0,
    done: 0,
    total: parsed.length,
  };
  let totalEstimatedImpressions = 0;
  let pctSum = 0;
  let withAuthorCount = 0;
  let withDraftCount = 0;
  const domainSet = new Set<string>();

  for (const r of parsed) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    totalEstimatedImpressions += r.estimatedImpressions;
    pctSum += r.citationPct;
    if (r.authorName || r.authorEmail) withAuthorCount++;
    if (r.emailDraft) withDraftCount++;
    domainSet.add(r.domain);
  }

  const searchLower = rawInput.search?.trim().toLowerCase() ?? "";
  const filtered = parsed.filter((r) => {
    if (rawInput.status && r.status !== rawInput.status) return false;
    if (rawInput.domain && r.domain !== rawInput.domain) return false;
    if (searchLower) {
      const hay = `${r.url} ${r.domain} ${r.authorName ?? ""} ${r.authorEmail ?? ""} ${r.notes ?? ""}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  return {
    rows: filtered,
    counts,
    stats: {
      totalEstimatedImpressions,
      avgCitationPct: parsed.length > 0 ? Number((pctSum / parsed.length).toFixed(1)) : 0,
      withAuthorCount,
      withDraftCount,
    },
    domains: [...domainSet].sort(),
  };
}

const createOutreachSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  url: z.string().trim().min(4).max(500),
  authorName: z.string().trim().max(140).optional().nullable(),
  authorEmail: z.string().trim().max(180).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** Adds a page by hand; its stats come from stored citations (zero when no answer cites it). */
export async function createOutreachOpportunity(
  db: Db,
  rawInput: { actorId: string; websiteId: string; url: string; authorName?: string | null; authorEmail?: string | null; notes?: string | null },
): Promise<OutreachOpportunityRow> {
  let input: z.infer<typeof createOutreachSchema>;
  try {
    input = createOutreachSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid outreach opportunity" : "Invalid outreach opportunity");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const normalized = parseExternalOutreachUrl(input.url, site.domain);
  if (input.authorEmail && !EMAIL_RE.test(input.authorEmail)) throw new DomainError("Invalid author email address");
  const stats = await statsForUrl(db, site, normalized.url);

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx.select({ url: outreachOpportunities.url }).from(outreachOpportunities).where(eq(outreachOpportunities.websiteId, site.id));
    if (existing.length >= MAX_OUTREACH_ITEMS) throw new DomainError(`A website can track at most ${MAX_OUTREACH_ITEMS} outreach opportunities`);
    if (existing.some((r) => r.url.toLowerCase() === normalized.url.toLowerCase())) throw new DomainError("This citation opportunity URL is already in your Outreach pipeline");
    const [created] = await tx
      .insert(outreachOpportunities)
      .values({
        websiteId: site.id,
        url: normalized.url,
        domain: normalized.domain,
        status: "new",
        citationPct: stats.citationPct.toFixed(2),
        estimatedImpressions: stats.estimatedImpressions,
        citations: stats.citations,
        authorName: input.authorName?.trim() || null,
        authorEmail: input.authorEmail?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "outreach_opportunity", entityId: created.id, change: "created", after: { url: created.url, domain: created.domain } });
    return toOpportunityRow(created);
  });
}

export async function getOutreachOpportunity(db: Db, input: { actorId: string; websiteId: string; opportunityId: string }): Promise<OutreachOpportunityRow> {
  if (!z.string().uuid().safeParse(input.opportunityId).success) throw new NotFoundError("Outreach opportunity not found");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const [row] = await db.select().from(outreachOpportunities).where(and(eq(outreachOpportunities.id, input.opportunityId), eq(outreachOpportunities.websiteId, site.id)));
  if (!row) throw new NotFoundError("Outreach opportunity not found");
  return toOpportunityRow(row);
}

/** Manual entry wins; otherwise the contact the fetched page itself publishes. Never guesses. */
function resolveAuthor(input: { page?: { html: string } | null; authorName?: string; authorEmail?: string }): { name: string | null; email: string | null; source: FoundAuthor["source"] | "manual" } {
  const manualName = input.authorName?.trim();
  const manualEmail = input.authorEmail?.trim();
  if (manualName || manualEmail) {
    if (manualEmail && !EMAIL_RE.test(manualEmail)) throw new DomainError("Invalid author email address");
    return { name: manualName || null, email: manualEmail || null, source: "manual" };
  }
  if (!input.page) throw new DomainError("The page could not be loaded. Add the author's name and email manually.");
  const found = authorFromHtml(input.page.html);
  if (!found.authorName) throw new DomainError("No author is named on this page. Add the contact manually if you know it.");
  return { name: found.authorName, email: found.authorEmail, source: found.source };
}

export async function findOutreachAuthor(
  db: Db,
  rawInput: { actorId: string; websiteId: string; opportunityId: string; page?: { html: string } | null; authorName?: string; authorEmail?: string },
): Promise<{ opportunity: OutreachOpportunityRow; source: FoundAuthor["source"] | "manual" }> {
  const author = resolveAuthor(rawInput);
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  return db.transaction(async (tx) => {
    const existing = await lockedOpportunity(tx, site.id, rawInput.opportunityId);
    const next = author.source === "manual" ? { authorName: author.name ?? existing.authorName, authorEmail: author.email ?? existing.authorEmail } : { authorName: author.name, authorEmail: author.email };
    const [updated] = await tx.update(outreachOpportunities).set(next).where(eq(outreachOpportunities.id, existing.id)).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: rawInput.actorId, websiteId: site.id, entityType: "outreach_opportunity", entityId: updated.id, change: "found_author", after: { ...next, source: author.source } });
    return { opportunity: toOpportunityRow(updated), source: author.source };
  });
}

export async function updateOutreachStatus(
  db: Db,
  rawInput: { actorId: string; websiteId: string; opportunityId: string; status: OutreachStatus },
): Promise<OutreachOpportunityRow> {
  if (!z.string().uuid().safeParse(rawInput.opportunityId).success) {
    throw new DomainError("Invalid outreach opportunity ID");
  }
  if (!(OUTREACH_STATUSES as readonly string[]).includes(rawInput.status)) {
    throw new DomainError("Invalid outreach status");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(outreachOpportunities)
      .where(and(eq(outreachOpportunities.id, rawInput.opportunityId), eq(outreachOpportunities.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Outreach opportunity not found");

    const [updated] = await tx
      .update(outreachOpportunities)
      .set({ status: rawInput.status })
      .where(eq(outreachOpportunities.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "outreach_opportunity",
      entityId: updated.id,
      change: `status_${rawInput.status}`,
      before: { status: existing.status },
      after: { status: updated.status, url: updated.url },
    });

    return toOpportunityRow(updated);
  });
}

const updateOutreachDetailsSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  authorName: z.string().trim().max(140).optional().nullable(),
  authorEmail: z.string().trim().max(180).optional().nullable(),
  emailDraft: z.string().trim().max(10_000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(OUTREACH_STATUSES).optional(),
});

export async function updateOutreachOpportunity(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    opportunityId: string;
    authorName?: string | null;
    authorEmail?: string | null;
    emailDraft?: string | null;
    notes?: string | null;
    status?: OutreachStatus;
  },
): Promise<OutreachOpportunityRow> {
  let input: z.infer<typeof updateOutreachDetailsSchema>;
  try {
    input = updateOutreachDetailsSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid outreach update");
  }
  if (input.authorEmail && !EMAIL_RE.test(input.authorEmail)) {
    throw new DomainError("Invalid author email address");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(outreachOpportunities)
      .where(and(eq(outreachOpportunities.id, input.opportunityId), eq(outreachOpportunities.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Outreach opportunity not found");

    const [updated] = await tx
      .update(outreachOpportunities)
      .set({
        authorName: input.authorName !== undefined ? input.authorName : existing.authorName,
        authorEmail: input.authorEmail !== undefined ? input.authorEmail : existing.authorEmail,
        emailDraft: input.emailDraft !== undefined ? input.emailDraft : existing.emailDraft,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        status: input.status ?? existing.status,
      })
      .where(eq(outreachOpportunities.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "outreach_opportunity",
      entityId: updated.id,
      change: "updated",
      after: { url: updated.url, status: updated.status },
    });

    return toOpportunityRow(updated);
  });
}

export async function deleteOutreachOpportunity(
  db: Db,
  rawInput: { actorId: string; websiteId: string; opportunityId: string },
): Promise<void> {
  if (!z.string().uuid().safeParse(rawInput.opportunityId).success) {
    throw new DomainError("Invalid outreach opportunity ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(outreachOpportunities)
      .where(and(eq(outreachOpportunities.id, rawInput.opportunityId), eq(outreachOpportunities.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Outreach opportunity not found");

    await tx.delete(outreachOpportunities).where(eq(outreachOpportunities.id, existing.id));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "outreach_opportunity",
      entityId: existing.id,
      change: "deleted",
      before: { url: existing.url },
    });
  });
}
