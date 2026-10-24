/**
 * Content Hub grid: spreadsheet-style items with custom JSONB columns, real
 * 30-day citation counts and publish targets. Writing steps live in pipeline.ts.
 */
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { type Db, contentItems, contentBriefs, contentDrafts, contentVersions, publishTargets, websites, prompts, responses, responseCitations } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { CONTENT_STATUSES, type ContentStatus, maskConfigSecrets, normKey, normalizeContentUrl } from "./shared";

export const MAX_CONTENT_ITEMS = 300;
const DAY = 86_400_000;

export interface ContentBriefRow {
  id: string;
  contentId: string;
  body: string;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface ContentDraftRow {
  id: string;
  contentId: string;
  briefId: string | null;
  body: string;
  createdAt: Date;
}

export interface ContentVersionRow {
  id: string;
  contentId: string;
  draftId: string | null;
  body: string;
  version: number;
  createdAt: Date;
}

export interface ContentHubItem {
  id: string;
  websiteId: string;
  title: string;
  targetUrl: string | null;
  promptId: string | null;
  promptText: string | null;
  status: ContentStatus;
  columns: Record<string, string | number | boolean>;
  agentStage: "idle" | "brief_ready" | "draft_ready" | "revised" | "published";
  citations30d: number;
  latestBrief: ContentBriefRow | null;
  latestDraft: ContentDraftRow | null;
  versions: ContentVersionRow[];
  createdAt: Date;
}

export interface PublishTargetSummary {
  id: string;
  provider: string;
  config: Record<string, string>;
  createdAt: Date;
}

export interface ContentHubSnapshot {
  items: ContentHubItem[];
  counts: {
    idea: number;
    brief: number;
    draft: number;
    review: number;
    approved: number;
    published: number;
    total: number;
  };
  customColumnKeys: string[];
  publishTargets: PublishTargetSummary[];
  prompts: { id: string; text: string }[];
}

const RESERVED_COLUMN_KEYS = new Set([
  "catalogProduct",
  "catalogProductId",
  "shopifyProductId",
  "handle",
  "price",
  "currentTitle",
  "currentDescription",
  "recommendedTitle",
  "appliedVersion",
  "appliedAt",
  "agentStage",
  "publishedProvider",
  "publishedUrl",
  "publishedAt",
  "publishedVersion",
  "remoteId",
  "verifiedLiveAt",
  "citationsSeed",
  "titleScore",
  "descScore",
  "faqStatus",
  "faqBody",
  // set by publishing, importing, revising and the Shopify catalog
  "remoteId",
  "verifiedLiveAt",
  "importedFrom",
  "importedFromUrl",
  "lastRevisedInstruction",
  "shopifyProductId",
  "handle",
  "price",
  "currentDescription",
  "recommendedTitle",
  "appliedVersion",
  "appliedAt",
]);

function inferAgentStage(
  status: ContentStatus,
  cols: Record<string, string | number | boolean>,
  hasBrief: boolean,
  hasDraft: boolean,
  versionCount: number,
): ContentHubItem["agentStage"] {
  if (status === "published" || cols.agentStage === "published") return "published";
  if (cols.agentStage === "revised" || versionCount > 1 || status === "review" || status === "approved") return "revised";
  if (hasDraft || status === "draft" || cols.agentStage === "draft_ready") return "draft_ready";
  if (hasBrief || status === "brief" || cols.agentStage === "brief_ready") return "brief_ready";
  return "idle";
}

export async function listContentHub(
  db: Db,
  rawInput: { actorId: string; websiteId: string; status?: ContentStatus; search?: string },
): Promise<ContentHubSnapshot> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:read");
  const since30d = new Date(Date.now() - 30 * DAY);

  const [itemRows, targetRows, promptRows, citationRows] = await Promise.all([
    db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .orderBy(desc(contentItems.createdAt), desc(contentItems.id)),
    db
      .select()
      .from(publishTargets)
      .where(eq(publishTargets.websiteId, site.id))
      .orderBy(publishTargets.provider),
    db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts)
      .where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)))
      .orderBy(desc(prompts.createdAt))
      .limit(100),
    db
      .select({
        url: responseCitations.url,
        count: sql<number>`count(*)::int`,
      })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, since30d)))
      .groupBy(responseCitations.url),
  ]);

  const editorialItems = itemRows.filter((r) => (r.columns ?? {}).catalogProduct !== true);
  const contentIds = editorialItems.map((r) => r.id);

  const [briefRows, draftRows, versionRows] =
    contentIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(contentBriefs)
            .where(inArray(contentBriefs.contentId, contentIds))
            .orderBy(desc(contentBriefs.createdAt), desc(contentBriefs.id)),
          db
            .select()
            .from(contentDrafts)
            .where(inArray(contentDrafts.contentId, contentIds))
            .orderBy(desc(contentDrafts.createdAt), desc(contentDrafts.id)),
          db
            .select()
            .from(contentVersions)
            .where(inArray(contentVersions.contentId, contentIds))
            .orderBy(desc(contentVersions.version), desc(contentVersions.createdAt)),
        ])
      : [[], [], []];

  const latestBriefByContent = new Map<string, ContentBriefRow>();
  for (const b of briefRows) {
    if (!latestBriefByContent.has(b.contentId)) {
      latestBriefByContent.set(b.contentId, {
        id: b.id,
        contentId: b.contentId,
        body: b.body,
        approvedAt: b.approvedAt ?? null,
        createdAt: b.createdAt,
      });
    }
  }

  const latestDraftByContent = new Map<string, ContentDraftRow>();
  for (const d of draftRows) {
    if (!latestDraftByContent.has(d.contentId)) {
      latestDraftByContent.set(d.contentId, {
        id: d.id,
        contentId: d.contentId,
        briefId: d.briefId ?? null,
        body: d.body,
        createdAt: d.createdAt,
      });
    }
  }

  const versionsByContent = new Map<string, ContentVersionRow[]>();
  for (const v of versionRows) {
    const arr = versionsByContent.get(v.contentId) ?? [];
    arr.push({
      id: v.id,
      contentId: v.contentId,
      draftId: v.draftId ?? null,
      body: v.body,
      version: v.version,
      createdAt: v.createdAt,
    });
    versionsByContent.set(v.contentId, arr);
  }

  const promptMap = new Map(promptRows.map((p) => [p.id, p.text]));
  const citationMap = new Map<string, number>();
  for (const c of citationRows) {
    try {
      const norm = normalizeContentUrl(c.url, site.domain);
      if (norm) citationMap.set(norm, (citationMap.get(norm) ?? 0) + Number(c.count ?? 0));
    } catch {
      // ignore malformed citation url
    }
  }

  const counts = {
    idea: 0,
    brief: 0,
    draft: 0,
    review: 0,
    approved: 0,
    published: 0,
    total: editorialItems.length,
  };

  const customKeySet = new Set<string>(["contentType", "targetKeyword", "persona"]);

  const allItems: ContentHubItem[] = editorialItems.map((row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    const cols = { ...(row.columns ?? {}) };
    for (const k of Object.keys(cols)) {
      if (!RESERVED_COLUMN_KEYS.has(k)) customKeySet.add(k);
    }
    const latestBrief = latestBriefByContent.get(row.id) ?? null;
    const latestDraft = latestDraftByContent.get(row.id) ?? null;
    const versions = versionsByContent.get(row.id) ?? [];
    const normTarget = row.targetUrl ? (normalizeContentUrl(row.targetUrl, site.domain) ?? row.targetUrl) : null;
    const dbCitations = normTarget ? (citationMap.get(normTarget) ?? 0) : 0;

    return {
      id: row.id,
      websiteId: row.websiteId,
      title: row.title,
      targetUrl: normTarget,
      promptId: row.promptId ?? null,
      promptText: row.promptId ? (promptMap.get(row.promptId) ?? null) : null,
      status: row.status,
      columns: cols,
      agentStage: inferAgentStage(row.status, cols, Boolean(latestBrief), Boolean(latestDraft), versions.length),
      citations30d: dbCitations,
      latestBrief,
      latestDraft,
      versions,
      createdAt: row.createdAt,
    };
  });

  const searchLower = rawInput.search?.trim().toLowerCase() ?? "";
  const filtered = allItems.filter((item) => {
    if (rawInput.status && item.status !== rawInput.status) return false;
    if (searchLower) {
      const hay = `${item.title} ${item.targetUrl ?? ""} ${item.promptText ?? ""} ${Object.values(item.columns).join(" ")}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  return {
    items: filtered,
    counts,
    customColumnKeys: [...customKeySet],
    publishTargets: targetRows.map((t) => ({
      id: t.id,
      provider: t.provider,
      config: maskConfigSecrets(t.config),
      createdAt: t.createdAt,
    })),
    prompts: promptRows,
  };
}

const createContentSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(220),
  targetUrl: z.string().max(500).optional().nullable(),
  promptId: z.string().uuid().optional().nullable(),
  status: z.enum(CONTENT_STATUSES).default("idea"),
  columns: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function createContentItem(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    title: string;
    targetUrl?: string | null;
    promptId?: string | null;
    status?: ContentStatus;
    columns?: Record<string, string | number | boolean>;
  },
) {
  let input: z.infer<typeof createContentSchema>;
  try {
    input = createContentSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid content item" : "Invalid content item");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  // a planned page has no URL until it exists
  const normalizedUrl = input.targetUrl ? normalizeContentUrl(input.targetUrl, site.domain) : null;

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");

    if (input.promptId) {
      const [p] = await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.id, input.promptId), eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
      if (!p) throw new NotFoundError("Linked prompt not found in this workspace");
    }

    const existing = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
    // Shopify catalog products live in the same table but do not use the editorial quota
    if (existing.filter((r) => (r.columns ?? {}).catalogProduct !== true).length >= MAX_CONTENT_ITEMS) {
      throw new DomainError(`A website can have at most ${MAX_CONTENT_ITEMS} content items`);
    }
    if (existing.some((r) => (r.columns ?? {}).catalogProduct !== true && normKey(r.title) === normKey(input.title))) {
      throw new DomainError(`A content item titled "${input.title}" already exists`);
    }

    const mergedColumns: Record<string, string | number | boolean> = {
      contentType: "Article",
      targetKeyword: input.title.toLowerCase(),
      persona: "Product Teams",
      agentStage: "idle",
      ...(input.columns ?? {}),
    };

    const [created] = await tx
      .insert(contentItems)
      .values({
        websiteId: site.id,
        title: input.title,
        targetUrl: normalizedUrl,
        promptId: input.promptId ?? null,
        status: input.status,
        columns: mergedColumns,
      })
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: created.id,
      change: "created",
      after: { title: created.title, targetUrl: created.targetUrl, status: created.status },
    });

    return created;
  });
}

const updateContentSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  contentId: z.string().uuid(),
  title: z.string().trim().min(3).max(220).optional(),
  targetUrl: z.string().max(500).optional().nullable(),
  promptId: z.string().uuid().optional().nullable(),
  status: z.enum(CONTENT_STATUSES).optional(),
  columns: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function updateContentItem(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    contentId: string;
    title?: string;
    targetUrl?: string | null;
    promptId?: string | null;
    status?: ContentStatus;
    columns?: Record<string, string | number | boolean>;
  },
) {
  let input: z.infer<typeof updateContentSchema>;
  try {
    input = updateContentSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid content item update");
  }
  const managed = Object.keys(input.columns ?? {}).find((k) => RESERVED_COLUMN_KEYS.has(k));
  if (managed) throw new DomainError(`"${managed}" is managed by Athenum and can't be edited`);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const normalizedUrl = input.targetUrl !== undefined ? normalizeContentUrl(input.targetUrl, site.domain) : undefined;

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, input.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
    if (!existing) throw new NotFoundError("Content item not found");
    // "published" means a CMS accepted the post or the live page was checked
    if (input.status === "published" && existing.status !== "published") {
      throw new DomainError("Publish to a connected CMS or use “Check page & mark published” to mark content as published.");
    }

    if (input.promptId) {
      const [p] = await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.id, input.promptId), eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
      if (!p) throw new NotFoundError("Linked prompt not found in this workspace");
    }

    const nextTitle = input.title ?? existing.title;
    if (normKey(nextTitle) !== normKey(existing.title)) {
      const others = await tx
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
      if (others.some((r) => r.id !== existing.id && normKey(r.title) === normKey(nextTitle))) {
        throw new DomainError(`A content item titled "${nextTitle}" already exists`);
      }
    }

    const nextColumns = {
      ...(existing.columns ?? {}),
      ...(input.columns ?? {}),
    };

    const [updated] = await tx
      .update(contentItems)
      .set({
        title: nextTitle,
        targetUrl: normalizedUrl !== undefined ? normalizedUrl : existing.targetUrl,
        promptId: input.promptId !== undefined ? input.promptId : existing.promptId,
        status: input.status ?? existing.status,
        columns: nextColumns,
      })
      .where(eq(contentItems.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: updated.id,
      change: "updated",
      before: { title: existing.title, status: existing.status },
      after: { title: updated.title, status: updated.status },
    });

    return updated;
  });
}

export async function deleteContentItem(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string },
): Promise<void> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!existing) throw new NotFoundError("Content item not found");

    await tx.update(contentItems).set({ deletedAt: new Date() }).where(eq(contentItems.id, existing.id));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: existing.id,
      change: "deleted",
      before: { title: existing.title },
    });
  });
}

/* ---------------- AI Agent Actions: Brief -> Draft -> Revise with Athena ---------------- */

