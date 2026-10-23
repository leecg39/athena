/**
 * Knowledge Base engine:
 *  - Pillars CRUD (grouped brand knowledge categories + markdown reference documents)
 *  - Facts CRUD + Approval Queue (`pending_review` -> `confirmed` / `rejected`)
 *  - Candidate fact extraction from brand profile and collected AI responses
 *  - Internal Link Pages (`site_health_pages`) with anchor keywords, linked fact counts, and AI citation counts
 */
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Db, kbPillars, kbFacts, oracleFindings, websites, responses, responseCitations, siteHealthPages } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { isBrandDomain } from "../extract";
import { normalizeUrl } from "../sources";

export const FACT_STATUSES = ["pending_review", "confirmed", "rejected"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const MAX_PILLARS = 40;
export const MAX_FACTS_PER_WEBSITE = 500;

export interface PillarItem {
  id: string;
  websiteId: string;
  name: string;
  document: string | null;
  confirmedCount: number;
  pendingCount: number;
  createdAt: Date;
}

export interface FactItem {
  id: string;
  websiteId: string;
  pillarId: string;
  pillarName: string;
  claim: string;
  sourceUrl: string | null;
  status: FactStatus;
  confidence: number;
  createdAt: Date;
}

export interface InternalLinkItem {
  id: string;
  websiteId: string;
  url: string;
  title: string;
  keywords: { keyword: string; position: number }[];
  aiAccessible: boolean;
  inSitemap: boolean;
  factCount: number;
  citationCount: number;
  createdAt: Date;
}

export interface KnowledgeBaseData {
  pillars: PillarItem[];
  facts: FactItem[];
  internalLinks: InternalLinkItem[];
  counts: {
    pillars: number;
    confirmed: number;
    pendingReview: number;
    rejected: number;
    internalLinks: number;
  };
}

function normKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseSourceUrl(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  const normalized = normalizeUrl(trimmed);
  if (!normalized) throw new DomainError("Source URL must be a valid http(s) URL");
  return normalized;
}

function parseBrandInternalUrl(raw: string, brandDomain: string): string {
  const normalized = normalizeUrl(raw.trim());
  if (!normalized) throw new DomainError("Enter a valid http(s) URL on your brand domain");
  let host = "";
  try {
    host = new URL(normalized).hostname;
  } catch {
    throw new DomainError("Enter a valid http(s) URL on your brand domain");
  }
  if (!isBrandDomain(host, brandDomain)) {
    throw new DomainError(`Internal link URL must belong to ${brandDomain}`);
  }
  return normalized;
}

export async function listKnowledgeBase(
  db: Db,
  rawInput: { actorId: string; websiteId: string },
): Promise<KnowledgeBaseData> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:read");
  return listKnowledgeBaseForSite(db, site);
}

export async function listKnowledgeBaseForSite(db: Db, site: WebsiteRow): Promise<KnowledgeBaseData> {
  const [pillarRows, factRows, linkRows, citeRows] = await Promise.all([
    db
      .select()
      .from(kbPillars)
      .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)))
      .orderBy(asc(kbPillars.createdAt), asc(kbPillars.id)),
    db
      .select()
      .from(kbFacts)
      .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)))
      .orderBy(desc(kbFacts.createdAt), desc(kbFacts.id)),
    db
      .select()
      .from(siteHealthPages)
      .where(eq(siteHealthPages.websiteId, site.id))
      .orderBy(asc(siteHealthPages.url), asc(siteHealthPages.id)),
    db
      .select({
        url: sql<string>`coalesce(${responseCitations.normalizedUrl}, ${responseCitations.url})`,
        n: sql<number>`count(distinct ${responses.id})::int`,
      })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .where(and(eq(responses.websiteId, site.id), eq(responseCitations.isBrand, true)))
      .groupBy(sql`1`),
  ]);

  const pillarById = new Map(pillarRows.map((p) => [p.id, p]));
  const liveFacts = factRows.filter((f) => pillarById.has(f.pillarId));

  const confirmedByPillar = new Map<string, number>();
  const pendingByPillar = new Map<string, number>();
  const factsByUrl = new Map<string, number>();
  let confirmed = 0;
  let pendingReview = 0;
  let rejected = 0;

  for (const f of liveFacts) {
    if (f.status === "confirmed") {
      confirmed++;
      confirmedByPillar.set(f.pillarId, (confirmedByPillar.get(f.pillarId) ?? 0) + 1);
    } else if (f.status === "pending_review") {
      pendingReview++;
      pendingByPillar.set(f.pillarId, (pendingByPillar.get(f.pillarId) ?? 0) + 1);
    } else if (f.status === "rejected") {
      rejected++;
    }
    if (f.sourceUrl && f.status !== "rejected") {
      const nu = normalizeUrl(f.sourceUrl) ?? f.sourceUrl;
      factsByUrl.set(nu, (factsByUrl.get(nu) ?? 0) + 1);
    }
  }

  const citationsByUrl = new Map<string, number>();
  for (const c of citeRows) {
    const nu = normalizeUrl(c.url) ?? c.url;
    citationsByUrl.set(nu, (citationsByUrl.get(nu) ?? 0) + c.n);
  }

  const pillars: PillarItem[] = pillarRows.map((p) => ({
    id: p.id,
    websiteId: p.websiteId,
    name: p.name,
    document: p.document ?? null,
    confirmedCount: confirmedByPillar.get(p.id) ?? 0,
    pendingCount: pendingByPillar.get(p.id) ?? 0,
    createdAt: p.createdAt,
  }));

  const facts: FactItem[] = liveFacts.map((f) => ({
    id: f.id,
    websiteId: f.websiteId,
    pillarId: f.pillarId,
    pillarName: pillarById.get(f.pillarId)?.name ?? "General",
    claim: f.claim,
    sourceUrl: f.sourceUrl ?? null,
    status: f.status,
    confidence: Number(f.confidence ?? 0.9),
    createdAt: f.createdAt,
  }));

  const internalLinks: InternalLinkItem[] = linkRows.map((l) => {
    const nu = normalizeUrl(l.url) ?? l.url;
    return {
      id: l.id,
      websiteId: l.websiteId,
      url: nu,
      title: l.title || nu.replace(/^https?:\/\/[^/]+/, "") || "/",
      keywords: Array.isArray(l.keywords) ? l.keywords : [],
      aiAccessible: l.aiAccessible ?? true,
      inSitemap: l.inSitemap ?? true,
      factCount: factsByUrl.get(nu) ?? 0,
      citationCount: citationsByUrl.get(nu) ?? 0,
      createdAt: l.createdAt,
    };
  });

  return {
    pillars,
    facts,
    internalLinks,
    counts: {
      pillars: pillars.length,
      confirmed,
      pendingReview,
      rejected,
      internalLinks: internalLinks.length,
    },
  };
}

const createPillarSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  name: z.string().trim().min(2, "Pillar name must be at least 2 characters").max(100),
  document: z.string().trim().max(20_000).optional().nullable(),
});

export async function createPillar(
  db: Db,
  rawInput: { actorId: string; websiteId: string; name: string; document?: string | null },
) {
  let input: z.infer<typeof createPillarSchema>;
  try {
    input = createPillarSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid pillar" : "Invalid pillar");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx
      .select()
      .from(kbPillars)
      .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)));
    if (existing.length >= MAX_PILLARS) {
      throw new DomainError(`A website can have at most ${MAX_PILLARS} knowledge pillars`);
    }
    if (existing.some((p) => normKey(p.name) === normKey(input.name))) {
      throw new DomainError(`A pillar named "${input.name}" already exists`);
    }

    const [created] = await tx
      .insert(kbPillars)
      .values({
        websiteId: site.id,
        name: input.name,
        document: input.document?.trim() || null,
      })
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "kb_pillar",
      entityId: created.id,
      change: "created",
      after: { name: created.name },
    });

    return created;
  });
}

const updatePillarSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  pillarId: z.string().uuid(),
  name: z.string().trim().min(2).max(100).optional(),
  document: z.string().max(20_000).optional().nullable(),
});

export async function updatePillar(
  db: Db,
  rawInput: { actorId: string; websiteId: string; pillarId: string; name?: string; document?: string | null },
) {
  let input: z.infer<typeof updatePillarSchema>;
  try {
    input = updatePillarSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid pillar update");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx
      .select()
      .from(kbPillars)
      .where(and(eq(kbPillars.id, input.pillarId), eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)));
    if (!existing) throw new NotFoundError("Pillar not found");

    const nextName = input.name ?? existing.name;
    const nextDoc = input.document !== undefined ? input.document?.trim() || null : existing.document;

    if (normKey(nextName) !== normKey(existing.name)) {
      const others = await tx
        .select()
        .from(kbPillars)
        .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)));
      if (others.some((p) => p.id !== existing.id && normKey(p.name) === normKey(nextName))) {
        throw new DomainError(`A pillar named "${nextName}" already exists`);
      }
    }

    const [updated] = await tx
      .update(kbPillars)
      .set({ name: nextName, document: nextDoc })
      .where(eq(kbPillars.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "kb_pillar",
      entityId: updated.id,
      change: "updated",
      before: { name: existing.name },
      after: { name: updated.name },
    });

    return updated;
  });
}

export async function deletePillar(
  db: Db,
  rawInput: { actorId: string; websiteId: string; pillarId: string },
): Promise<void> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  const now = new Date();
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(kbPillars)
      .where(and(eq(kbPillars.id, rawInput.pillarId), eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)))
      .for("update");
    if (!existing) throw new NotFoundError("Pillar not found");

    await tx.update(kbPillars).set({ deletedAt: now }).where(eq(kbPillars.id, existing.id));
    const deletedFacts = await tx
      .update(kbFacts)
      .set({ deletedAt: now })
      .where(and(eq(kbFacts.pillarId, existing.id), isNull(kbFacts.deletedAt)))
      .returning({ id: kbFacts.id });
    if (deletedFacts.length > 0) {
      await tx
        .update(oracleFindings)
        .set({ status: "resolved" })
        .where(
          and(
            eq(oracleFindings.websiteId, site.id),
            inArray(oracleFindings.factId, deletedFacts.map((f) => f.id)),
            inArray(oracleFindings.status, ["open", "resolving"]),
          ),
        );
    }

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "kb_pillar",
      entityId: existing.id,
      change: "deleted",
      before: { name: existing.name },
    });
  });
}

const createFactSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  pillarId: z.string().uuid(),
  claim: z.string().trim().min(4, "Fact claim must be at least 4 characters").max(1000),
  sourceUrl: z.string().max(500).optional().nullable(),
  status: z.enum(FACT_STATUSES).default("confirmed"),
  confidence: z.number().min(0).max(1).optional(),
});

export async function createFact(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    pillarId: string;
    claim: string;
    sourceUrl?: string | null;
    status?: FactStatus;
    confidence?: number;
  },
) {
  let input: z.infer<typeof createFactSchema>;
  try {
    input = createFactSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid fact" : "Invalid fact");
  }
  const sourceUrl = parseSourceUrl(input.sourceUrl);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [pillar] = await tx
      .select()
      .from(kbPillars)
      .where(and(eq(kbPillars.id, input.pillarId), eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)));
    if (!pillar) throw new NotFoundError("Pillar not found");

    const existing = await tx
      .select()
      .from(kbFacts)
      .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)));
    if (existing.length >= MAX_FACTS_PER_WEBSITE) {
      throw new DomainError(`A website can have at most ${MAX_FACTS_PER_WEBSITE} facts`);
    }
    if (existing.some((f) => f.status !== "rejected" && normKey(f.claim) === normKey(input.claim))) {
      throw new DomainError("This brand fact already exists in your Knowledge Base");
    }

    const defaultConf = input.status === "confirmed" ? 0.98 : 0.78;
    const conf = (input.confidence ?? defaultConf).toFixed(2);

    const [created] = await tx
      .insert(kbFacts)
      .values({
        websiteId: site.id,
        pillarId: pillar.id,
        claim: input.claim,
        sourceUrl,
        status: input.status,
        confidence: conf,
      })
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "kb_fact",
      entityId: created.id,
      change: "created",
      after: { claim: created.claim, status: created.status, pillar: pillar.name },
    });

    return {
      ...created,
      confidence: Number(created.confidence ?? conf),
    };
  });
}

const updateFactSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  factId: z.string().uuid(),
  pillarId: z.string().uuid().optional(),
  claim: z.string().trim().min(4).max(1000).optional(),
  sourceUrl: z.string().max(500).optional().nullable(),
  status: z.enum(FACT_STATUSES).optional(),
});

export async function updateFact(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    factId: string;
    pillarId?: string;
    claim?: string;
    sourceUrl?: string | null;
    status?: FactStatus;
  },
) {
  let input: z.infer<typeof updateFactSchema>;
  try {
    input = updateFactSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid fact update");
  }
  const sourceUrl = input.sourceUrl !== undefined ? parseSourceUrl(input.sourceUrl) : undefined;
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx
      .select()
      .from(kbFacts)
      .where(and(eq(kbFacts.id, input.factId), eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)));
    if (!existing) throw new NotFoundError("Fact not found");

    const nextPillarId = input.pillarId ?? existing.pillarId;
    if (nextPillarId !== existing.pillarId) {
      const [pillar] = await tx
        .select()
        .from(kbPillars)
        .where(and(eq(kbPillars.id, nextPillarId), eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)));
      if (!pillar) throw new NotFoundError("Target pillar not found");
    }

    const nextClaim = input.claim ?? existing.claim;
    if (normKey(nextClaim) !== normKey(existing.claim)) {
      const others = await tx
        .select()
        .from(kbFacts)
        .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)));
      if (others.some((f) => f.id !== existing.id && f.status !== "rejected" && normKey(f.claim) === normKey(nextClaim))) {
        throw new DomainError("Another fact with this exact claim already exists");
      }
    }

    const [updated] = await tx
      .update(kbFacts)
      .set({
        pillarId: nextPillarId,
        claim: nextClaim,
        sourceUrl: sourceUrl !== undefined ? sourceUrl : existing.sourceUrl,
        status: input.status ?? existing.status,
      })
      .where(eq(kbFacts.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "kb_fact",
      entityId: updated.id,
      change: "updated",
      before: { claim: existing.claim, status: existing.status },
      after: { claim: updated.claim, status: updated.status },
    });

    return {
      ...updated,
      confidence: Number(updated.confidence ?? 0.9),
    };
  });
}

const reviewFactSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  factId: z.string().uuid(),
  decision: z.enum(["confirmed", "rejected"]),
  claim: z.string().trim().min(4).max(1000).optional(),
});

export async function reviewFact(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    factId: string;
    decision: "confirmed" | "rejected";
    claim?: string;
  },
) {
  let input: z.infer<typeof reviewFactSchema>;
  try {
    input = reviewFactSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid review action");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(kbFacts)
      .where(and(eq(kbFacts.id, input.factId), eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)))
      .for("update");
    if (!existing) throw new NotFoundError("Fact not found");

    const nextClaim = input.claim ?? existing.claim;
    const nextConf = input.decision === "confirmed" ? "1.00" : existing.confidence;

    const [updated] = await tx
      .update(kbFacts)
      .set({
        claim: nextClaim,
        status: input.decision,
        confidence: nextConf,
      })
      .where(eq(kbFacts.id, existing.id))
      .returning();

    if (input.decision === "rejected") {
      await tx
        .update(oracleFindings)
        .set({ status: "resolved" })
        .where(
          and(
            eq(oracleFindings.websiteId, site.id),
            eq(oracleFindings.factId, existing.id),
            inArray(oracleFindings.status, ["open", "resolving"]),
          ),
        );
    }

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "kb_fact",
      entityId: updated.id,
      change: input.decision,
      before: { status: existing.status },
      after: { status: updated.status, claim: updated.claim },
    });

    return {
      ...updated,
      confidence: Number(updated.confidence ?? 1),
    };
  });
}

export async function deleteFact(
  db: Db,
  rawInput: { actorId: string; websiteId: string; factId: string },
): Promise<void> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(kbFacts)
      .where(and(eq(kbFacts.id, rawInput.factId), eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)))
      .for("update");
    if (!existing) throw new NotFoundError("Fact not found");

    await tx.update(kbFacts).set({ deletedAt: new Date() }).where(eq(kbFacts.id, existing.id));
    await tx
      .update(oracleFindings)
      .set({ status: "resolved" })
      .where(
        and(
          eq(oracleFindings.websiteId, site.id),
          eq(oracleFindings.factId, existing.id),
          inArray(oracleFindings.status, ["open", "resolving"]),
        ),
      );
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "kb_fact",
      entityId: existing.id,
      change: "deleted",
      before: { claim: existing.claim },
    });
  });
}

/* ---------------- Automatic Fact Extraction ---------------- */

interface ExtractedCandidate {
  pillarName: string;
  pillarDoc: string;
  claim: string;
  sourceUrl: string | null;
  status: FactStatus;
  confidence: string;
}

function classifyPillarForClaim(claim: string, brandName: string): { name: string; doc: string } {
  const lower = claim.toLowerCase();
  if (/(\$\d+|\bprice|\bpricing|\bplan|\btier|\bfree\b|\bmonth|\bbilling|\bseat|\buser)/i.test(lower)) {
    return {
      name: "Pricing & Plans",
      doc: `# Pricing & Plans\nOfficial pricing tiers, free workspace limits, and billing policies for ${brandName}.`,
    };
  }
  if (/(\bsoc\s*2|\bhipaa|\bgdpr|\bsecurity|\bsso|\bcompliance|\bencrypt|\benterprise)/i.test(lower)) {
    return {
      name: "Security & Enterprise",
      doc: `# Security & Enterprise\nEnterprise security certifications, access controls, and compliance facts for ${brandName}.`,
    };
  }
  if (/(\bfounded|\bheadquarter|\bcompany|\bteam|\bmission|\bindustry)/i.test(lower)) {
    return {
      name: "Company & Brand",
      doc: `# Company & Brand\nCore company background, positioning, and target audience for ${brandName}.`,
    };
  }
  return {
    name: "Product & Features",
    doc: `# Product & Features\nVerified product capabilities, workflows, and differentiators for ${brandName}.`,
  };
}

export async function extractKnowledgeFacts(
  db: Db,
  rawInput: { actorId: string; websiteId: string },
): Promise<{ createdPillars: number; createdFacts: number }> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");

    const [existingPillars, existingFacts, respRows] = await Promise.all([
      tx
        .select()
        .from(kbPillars)
        .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt))),
      tx
        .select()
        .from(kbFacts)
        .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt))),
      tx
        .select({ id: responses.id, rawText: sql<string>`left(${responses.rawText}, 6000)` })
        .from(responses)
        .where(and(eq(responses.websiteId, site.id), eq(responses.mentioned, true)))
        .orderBy(desc(responses.ranAt))
        .limit(60),
    ]);

    const candidates: ExtractedCandidate[] = [];

    // 1. Candidate claims from Brand Profile — queued as pending_review with no invented sourceUrl
    const profile = site.profile ?? {};
    if (profile.description && profile.description.trim().length >= 10) {
      const p = classifyPillarForClaim(profile.description, site.name);
      candidates.push({
        pillarName: p.name,
        pillarDoc: p.doc,
        claim: profile.description.trim(),
        sourceUrl: null,
        status: "pending_review",
        confidence: "0.90",
      });
    }

    for (const aud of profile.audiences ?? []) {
      if (typeof aud === "string" && aud.trim().length >= 3) {
        candidates.push({
          pillarName: "Company & Brand",
          pillarDoc: `# Company & Brand\nCore company background, positioning, and target audience for ${site.name}.`,
          claim: `${site.name} is designed for ${aud.trim()}.`,
          sourceUrl: null,
          status: "pending_review",
          confidence: "0.85",
        });
      }
    }
    for (const diff of profile.differentiators ?? []) {
      if (typeof diff === "string" && diff.trim().length >= 4) {
        const claim = diff.toLowerCase().includes(site.name.toLowerCase()) ? diff.trim() : `${site.name} provides ${diff.trim()}.`;
        const p = classifyPillarForClaim(claim, site.name);
        candidates.push({
          pillarName: p.name,
          pillarDoc: p.doc,
          claim,
          sourceUrl: null,
          status: "pending_review",
          confidence: "0.85",
        });
      }
    }
    for (const prod of profile.products ?? []) {
      if (typeof prod === "string" && prod.trim().length >= 3) {
        candidates.push({
          pillarName: "Product & Features",
          pillarDoc: `# Product & Features\nVerified product capabilities, workflows, and differentiators for ${site.name}.`,
          claim: `${site.name} offers ${prod.trim()}.`,
          sourceUrl: null,
          status: "pending_review",
          confidence: "0.85",
        });
      }
    }

    // 2. Candidate claims extracted from stored AI answers mentioning the brand
    const brandRe = new RegExp(`\\b${site.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const factualRe = /(\$\d+|\b\d+\s*(?:users|seats|members|days|gb|%)|\bfree\s+(?:plan|tier|trial)|\bfounded\s+in\s+\d{4}|\bsupports\b|\bintegrates\s+with\b|\bbuilt\s+for\b|\brecommended\s+for\b)/i;

    for (const r of respRows) {
      const sentences = r.rawText
        .replace(/\r/g, "\n")
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.replace(/^[\s*\-•\d.)#]+/, "").replace(/\*\*/g, "").trim())
        .filter((s) => s.length >= 24 && s.length <= 220);

      for (const s of sentences) {
        if (!brandRe.test(s)) continue;
        if (!factualRe.test(s)) continue;
        const p = classifyPillarForClaim(s, site.name);
        const hasNumber = /\d/.test(s);
        candidates.push({
          pillarName: p.name,
          pillarDoc: p.doc,
          claim: s,
          sourceUrl: null,
          status: "pending_review",
          confidence: hasNumber ? "0.76" : "0.68",
        });
        if (candidates.length >= 18) break;
      }
      if (candidates.length >= 18) break;
    }

    const pillarByKey = new Map(existingPillars.map((p) => [normKey(p.name), p]));
    const factKeys = new Set(existingFacts.map((f) => normKey(f.claim)));

    let createdPillars = 0;
    let createdFacts = 0;

    for (const cand of candidates) {
      const fKey = normKey(cand.claim);
      if (factKeys.has(fKey)) continue;

      const pKey = normKey(cand.pillarName);
      let pillar = pillarByKey.get(pKey);
      if (!pillar) {
        const [insertedPillar] = await tx
          .insert(kbPillars)
          .values({
            websiteId: site.id,
            name: cand.pillarName,
            document: cand.pillarDoc,
          })
          .returning();
        pillar = insertedPillar;
        pillarByKey.set(pKey, pillar);
        createdPillars++;
      }

      await tx.insert(kbFacts).values({
        websiteId: site.id,
        pillarId: pillar.id,
        claim: cand.claim,
        sourceUrl: cand.sourceUrl,
        status: cand.status,
        confidence: cand.confidence,
      });
      factKeys.add(fKey);
      createdFacts++;
    }

    if (rawInput.actorId && (createdPillars > 0 || createdFacts > 0)) {
      await logActivity(tx, {
        organizationId: site.organizationId,
        userId: rawInput.actorId,
        websiteId: site.id,
        entityType: "kb_fact",
        change: "extracted",
        after: { createdPillars, createdFacts },
      });
    }

    return { createdPillars, createdFacts };
  });
}

/* ---------------- Internal Link Pages ---------------- */

const upsertLinkSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  url: z.string().trim().min(4).max(500),
  title: z.string().trim().min(1).max(160).optional(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

export async function upsertInternalLink(
  db: Db,
  rawInput: { actorId: string; websiteId: string; url: string; title?: string; keywords?: string[] },
): Promise<InternalLinkItem> {
  let input: z.infer<typeof upsertLinkSchema>;
  try {
    input = upsertLinkSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid internal link" : "Invalid internal link");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const normalized = parseBrandInternalUrl(input.url, site.domain);

  const uniqueKeywords = [...new Set(input.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].map(
    (keyword, idx) => ({ keyword, position: idx + 1 }),
  );
  const defaultTitle = input.title?.trim() || normalized.replace(/^https?:\/\/[^/]+/, "") || `${site.name} Home`;

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx
      .select()
      .from(siteHealthPages)
      .where(eq(siteHealthPages.websiteId, site.id));
    const match = existing.find((r) => (normalizeUrl(r.url) ?? r.url) === normalized);

    let saved: typeof siteHealthPages.$inferSelect;
    if (match) {
      const [upd] = await tx
        .update(siteHealthPages)
        .set({
          url: normalized,
          title: defaultTitle,
          keywords: uniqueKeywords,
          lastCheckedAt: new Date(),
        })
        .where(eq(siteHealthPages.id, match.id))
        .returning();
      saved = upd;
    } else {
      const [ins] = await tx
        .insert(siteHealthPages)
        .values({
          websiteId: site.id,
          url: normalized,
          title: defaultTitle,
          statusCode: 200,
          aiAccessible: true,
          inSitemap: true,
          keywords: uniqueKeywords,
          lastCheckedAt: new Date(),
        })
        .returning();
      saved = ins;
    }

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "kb_internal_link",
      entityId: saved.id,
      change: match ? "updated" : "created",
      after: { url: saved.url, title: saved.title, keywords: uniqueKeywords.map((k) => k.keyword) },
    });

    return {
      id: saved.id,
      websiteId: saved.websiteId,
      url: normalized,
      title: saved.title || defaultTitle,
      keywords: saved.keywords ?? [],
      aiAccessible: saved.aiAccessible ?? true,
      inSitemap: saved.inSitemap ?? true,
      factCount: 0,
      citationCount: 0,
      createdAt: saved.createdAt,
    };
  });
}

export async function deleteInternalLink(
  db: Db,
  rawInput: { actorId: string; websiteId: string; linkId: string },
): Promise<void> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(siteHealthPages)
      .where(and(eq(siteHealthPages.id, rawInput.linkId), eq(siteHealthPages.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Internal link page not found");

    await tx.delete(siteHealthPages).where(eq(siteHealthPages.id, existing.id));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "kb_internal_link",
      entityId: existing.id,
      change: "deleted",
      before: { url: existing.url },
    });
  });
}

function inferTitleAndKeywords(url: string, brandName: string): { title: string; keywords: { keyword: string; position: number }[] } {
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    path = "/";
  }
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (!clean) {
    return {
      title: `${brandName} — Official Platform Overview`,
      keywords: [
        { keyword: brandName.toLowerCase(), position: 1 },
        { keyword: "ai design platform", position: 2 },
      ],
    };
  }
  const words = clean
    .split(/[\/\-_]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const pretty = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return {
    title: `${brandName} ${pretty}`,
    keywords: words.slice(0, 4).map((w, i) => ({ keyword: `${brandName.toLowerCase()} ${w}`, position: i + 1 })),
  };
}

export async function syncInternalLinks(
  db: Db,
  rawInput: { actorId: string; websiteId: string },
): Promise<{ created: number }> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");

    const [existing, citeUrls, factUrls] = await Promise.all([
      tx.select().from(siteHealthPages).where(eq(siteHealthPages.websiteId, site.id)),
      tx
        .selectDistinct({ url: sql<string>`coalesce(${responseCitations.normalizedUrl}, ${responseCitations.url})` })
        .from(responseCitations)
        .innerJoin(responses, eq(responses.id, responseCitations.responseId))
        .where(and(eq(responses.websiteId, site.id), eq(responseCitations.isBrand, true))),
      tx
        .selectDistinct({ url: kbFacts.sourceUrl })
        .from(kbFacts)
        .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt))),
    ]);

    const seen = new Set(existing.map((e) => normalizeUrl(e.url) ?? e.url));
    const discovered = new Set<string>();

    for (const c of citeUrls) {
      const nu = normalizeUrl(c.url);
      if (nu) discovered.add(nu);
    }
    for (const f of factUrls) {
      if (!f.url) continue;
      const nu = normalizeUrl(f.url);
      if (nu) {
        try {
          if (isBrandDomain(new URL(nu).hostname, site.domain)) discovered.add(nu);
        } catch {
          // ignore
        }
      }
    }

    let created = 0;
    for (const url of discovered) {
      if (seen.has(url)) continue;
      const meta = inferTitleAndKeywords(url, site.name);
      await tx.insert(siteHealthPages).values({
        websiteId: site.id,
        url,
        title: meta.title,
        statusCode: 0,
        aiAccessible: false,
        inSitemap: false,
        keywords: [],
        lastCheckedAt: null,
      });
      seen.add(url);
      created++;
    }

    return { created };
  });
}
