/**
 * Content writing pipeline: import an existing page (its real text), brief,
 * approval, draft, AI revision and manual versions. Generated text is written
 * by the caller (an AI writer in the web layer) or by honest templates;
 * nothing here invents facts, approves briefs or creates content implicitly.
 */
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { type Db, contentItems, contentBriefs, contentDrafts, contentVersions, websites } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { type ContentStatus, normKey, normalizeContentUrl } from "./shared";
import { MAX_CONTENT_ITEMS, type ContentBriefRow, type ContentDraftRow, type ContentVersionRow } from "./hub";
import { loadGroundingContext, pageToDraft, templateBrief, templateDraft, type GroundingContext } from "./grounding";

type ItemRow = typeof contentItems.$inferSelect;
const generatedBody = z.string().trim().min(10, "The generated text is too short").max(60_000, "Generated text is limited to 60,000 characters");

async function lockedItem(tx: Db, siteId: string, contentId: string): Promise<ItemRow> {
  if (!z.string().uuid().safeParse(contentId).success) throw new DomainError("Invalid content item ID");
  const [item] = await tx
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.id, contentId), eq(contentItems.websiteId, siteId), isNull(contentItems.deletedAt)))
    .for("update");
  if (!item) throw new NotFoundError("Content item not found");
  return item;
}

function bodyOrNull(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const r = generatedBody.safeParse(raw);
  if (!r.success) throw new DomainError(r.error.issues[0]?.message ?? "Invalid generated text");
  return r.data;
}

async function nextVersionNumber(tx: Db, contentId: string): Promise<number> {
  const [row] = await tx.select({ maxV: sql<number>`coalesce(max(${contentVersions.version}), 0)::int` }).from(contentVersions).where(eq(contentVersions.contentId, contentId));
  return Number(row?.maxV ?? 0) + 1;
}

const toBrief = (b: typeof contentBriefs.$inferSelect): ContentBriefRow => ({ id: b.id, contentId: b.contentId, body: b.body, approvedAt: b.approvedAt ?? null, createdAt: b.createdAt });
const toDraft = (d: typeof contentDrafts.$inferSelect): ContentDraftRow => ({ id: d.id, contentId: d.contentId, briefId: d.briefId ?? null, body: d.body, createdAt: d.createdAt });
const toVersion = (v: typeof contentVersions.$inferSelect): ContentVersionRow => ({ id: v.id, contentId: v.contentId, draftId: v.draftId ?? null, body: v.body, version: v.version, createdAt: v.createdAt });

export interface WritingItem {
  id: string;
  title: string;
  status: ContentStatus;
  targetUrl: string | null;
  columns: Record<string, string | number | boolean>;
}

/** Everything an AI writer may use for one item (no write). */
export async function contentWritingContext(
  db: Db,
  input: { actorId: string; websiteId: string; contentId: string },
): Promise<{ item: WritingItem; grounding: GroundingContext; brief: string | null; latestBody: string | null }> {
  if (!z.string().uuid().safeParse(input.contentId).success) throw new DomainError("Invalid content item ID");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, input.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
  if (!item) throw new NotFoundError("Content item not found");
  const [grounding, [brief], [version]] = await Promise.all([
    loadGroundingContext(db, site, item.promptId),
    db.select({ body: contentBriefs.body }).from(contentBriefs).where(eq(contentBriefs.contentId, item.id)).orderBy(desc(contentBriefs.createdAt)).limit(1),
    db.select({ body: contentVersions.body }).from(contentVersions).where(eq(contentVersions.contentId, item.id)).orderBy(desc(contentVersions.version)).limit(1),
  ]);
  return { item: { id: item.id, title: item.title, status: item.status, targetUrl: item.targetUrl, columns: item.columns ?? {} }, grounding, brief: brief?.body ?? null, latestBody: version?.body ?? null };
}

const importUrlSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  url: z.string().trim().min(4).max(500),
  title: z.string().trim().max(220).optional(),
  targetKeyword: z.string().trim().max(140).optional(),
});

const ownHost = (url: string, site: Pick<WebsiteRow, "domain">) => {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const own = site.domain.replace(/^www\./, "").toLowerCase();
  return host === own || host.endsWith(`.${own}`);
};

/** Imports one of the brand's own pages: its real text becomes draft v1 (the caller fetches the page). */
export async function importContentFromUrl(
  db: Db,
  rawInput: { actorId: string; websiteId: string; url: string; title?: string; targetKeyword?: string; page: { html: string } | null },
): Promise<ItemRow> {
  const parsed = importUrlSchema.safeParse(rawInput);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid import");
  const input = parsed.data;
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const url = normalizeContentUrl(input.url, site.domain);
  if (!url || !ownHost(url, site)) throw new DomainError(`Import pages from your own site (${site.domain})`);
  if (!rawInput.page) throw new DomainError("The page could not be loaded. Check that it is public and try again.");
  const page = pageToDraft(rawInput.page.html);
  if (!page.body) throw new DomainError("No readable text was found on that page");
  const title = input.title || page.title || new URL(url).pathname;
  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx.select({ title: contentItems.title, targetUrl: contentItems.targetUrl, columns: contentItems.columns }).from(contentItems).where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
    if (existing.filter((r) => (r.columns ?? {}).catalogProduct !== true).length >= MAX_CONTENT_ITEMS) throw new DomainError(`A website can have at most ${MAX_CONTENT_ITEMS} content items`);
    if (existing.some((r) => (r.columns ?? {}).catalogProduct !== true && (r.targetUrl === url || normKey(r.title) === normKey(title)))) throw new DomainError("This URL or title is already tracked in Content Hub");
    const [item] = await tx
      .insert(contentItems)
      .values({ websiteId: site.id, title, targetUrl: url, status: "draft", columns: { contentType: "Existing page", targetKeyword: input.targetKeyword || title.toLowerCase(), agentStage: "draft_ready", importedFrom: url } })
      .returning();
    const [draft] = await tx.insert(contentDrafts).values({ contentId: item.id, body: page.body }).returning();
    await tx.insert(contentVersions).values({ contentId: item.id, draftId: draft.id, body: page.body, version: 1 });
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "content_item", entityId: item.id, change: "imported_url", after: { url, title } });
    return item;
  });
}

/** Saves a brief: the caller's generated text, or the honest template. */
export async function generateContentBrief(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; focusNotes?: string; body?: string; source?: string },
): Promise<ContentBriefRow> {
  const given = bodyOrNull(rawInput.body);
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  return db.transaction(async (tx) => {
    const item = await lockedItem(tx, site.id, rawInput.contentId);
    const body = given ?? templateBrief({ title: item.title, columns: item.columns ?? {} }, await loadGroundingContext(tx, site, item.promptId), rawInput.focusNotes);
    const [brief] = await tx.insert(contentBriefs).values({ contentId: item.id, body }).returning();
    const status: ContentStatus = item.status === "idea" ? "brief" : item.status;
    await tx.update(contentItems).set({ status, columns: { ...(item.columns ?? {}), agentStage: "brief_ready" } }).where(eq(contentItems.id, item.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: rawInput.actorId, websiteId: site.id, entityType: "content_brief", entityId: brief.id, change: "generated_brief", after: { contentId: item.id, source: rawInput.source ?? "template" } });
    return toBrief(brief);
  });
}

/** Saves a draft as the next version: the caller's generated text, or the honest template. Briefs stay unapproved until a person approves them. */
export async function generateContentDraft(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; briefId?: string; instructions?: string; body?: string; source?: string },
): Promise<{ draft: ContentDraftRow; version: ContentVersionRow }> {
  if (rawInput.briefId && !z.string().uuid().safeParse(rawInput.briefId).success) throw new DomainError("Invalid brief ID");
  const given = bodyOrNull(rawInput.body);
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  return db.transaction(async (tx) => {
    const item = await lockedItem(tx, site.id, rawInput.contentId);
    const briefCond = rawInput.briefId ? and(eq(contentBriefs.id, rawInput.briefId), eq(contentBriefs.contentId, item.id)) : eq(contentBriefs.contentId, item.id);
    const [brief] = await tx.select({ id: contentBriefs.id }).from(contentBriefs).where(briefCond).orderBy(desc(contentBriefs.createdAt)).limit(1);
    if (rawInput.briefId && !brief) throw new NotFoundError("Brief not found");
    const body = given ?? templateDraft({ title: item.title, columns: item.columns ?? {} }, await loadGroundingContext(tx, site, item.promptId));
    const [draft] = await tx.insert(contentDrafts).values({ contentId: item.id, briefId: brief?.id ?? null, body }).returning();
    const [version] = await tx.insert(contentVersions).values({ contentId: item.id, draftId: draft.id, body, version: await nextVersionNumber(tx, item.id) }).returning();
    const status: ContentStatus = item.status === "idea" || item.status === "brief" ? "draft" : item.status;
    await tx.update(contentItems).set({ status, columns: { ...(item.columns ?? {}), agentStage: "draft_ready" } }).where(eq(contentItems.id, item.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: rawInput.actorId, websiteId: site.id, entityType: "content_draft", entityId: draft.id, change: "generated_draft", after: { contentId: item.id, version: version.version, source: rawInput.source ?? "template" } });
    return { draft: toDraft(draft), version: toVersion(version) };
  });
}

/** Stores an AI revision written by the caller as the next version (moves the item to review). */
export async function reviseWithAthena(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; instruction?: string; body?: string; source?: string },
): Promise<{ version: ContentVersionRow; status: ContentStatus }> {
  const body = bodyOrNull(rawInput.body);
  if (!body) throw new DomainError("Revisions are written by an AI provider; none returned text. Edit the draft directly instead.");
  const instruction = rawInput.instruction?.trim().slice(0, 500) || "General revision";
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  return db.transaction(async (tx) => {
    const item = await lockedItem(tx, site.id, rawInput.contentId);
    const [draft] = await tx.insert(contentDrafts).values({ contentId: item.id, body }).returning();
    const [version] = await tx.insert(contentVersions).values({ contentId: item.id, draftId: draft.id, body, version: await nextVersionNumber(tx, item.id) }).returning();
    const status: ContentStatus = item.status === "published" ? "published" : "review";
    await tx.update(contentItems).set({ status, columns: { ...(item.columns ?? {}), agentStage: status === "published" ? "published" : "revised", lastRevisedInstruction: instruction.slice(0, 160) } }).where(eq(contentItems.id, item.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: rawInput.actorId, websiteId: site.id, entityType: "content_version", entityId: version.id, change: "revised_with_athena", after: { contentId: item.id, version: version.version, instruction, source: rawInput.source ?? null } });
    return { version: toVersion(version), status };
  });
}

export async function approveContentBrief(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; briefId?: string; body?: string },
): Promise<ContentBriefRow> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  if (rawInput.briefId && !z.string().uuid().safeParse(rawInput.briefId).success) {
    throw new DomainError("Invalid brief ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    const [targetBrief] = rawInput.briefId
      ? await tx
          .select()
          .from(contentBriefs)
          .where(and(eq(contentBriefs.id, rawInput.briefId), eq(contentBriefs.contentId, item.id)))
      : await tx
          .select()
          .from(contentBriefs)
          .where(eq(contentBriefs.contentId, item.id))
          .orderBy(desc(contentBriefs.createdAt))
          .limit(1);
    if (!targetBrief) throw new NotFoundError("Content brief not found");

    const nextBody = rawInput.body?.trim() ? rawInput.body.trim() : targetBrief.body;
    const [updated] = await tx
      .update(contentBriefs)
      .set({
        body: nextBody,
        approvedAt: new Date(),
      })
      .where(eq(contentBriefs.id, targetBrief.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_brief",
      entityId: updated.id,
      change: "approved_brief",
      after: { contentId: item.id },
    });

    return {
      id: updated.id,
      contentId: updated.contentId,
      body: updated.body,
      approvedAt: updated.approvedAt ?? null,
      createdAt: updated.createdAt,
    };
  });
}

export async function saveContentVersion(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; body: string; status?: ContentStatus },
): Promise<ContentVersionRow> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  const body = rawInput.body?.trim();
  if (!body || body.length < 10) {
    throw new DomainError("Content version body must be at least 10 characters");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    const [maxVerRow] = await tx
      .select({ maxV: sql<number>`coalesce(max(${contentVersions.version}), 0)::int` })
      .from(contentVersions)
      .where(eq(contentVersions.contentId, item.id));
    const nextVersion = Number(maxVerRow?.maxV ?? 0) + 1;

    const [draft] = await tx
      .insert(contentDrafts)
      .values({
        contentId: item.id,
        body,
      })
      .returning();

    const [created] = await tx
      .insert(contentVersions)
      .values({
        contentId: item.id,
        draftId: draft.id,
        body,
        version: nextVersion,
      })
      .returning();

    const nextStatus = rawInput.status ?? (item.status === "idea" || item.status === "brief" ? "draft" : item.status);
    await tx
      .update(contentItems)
      .set({
        status: nextStatus,
        columns: { ...(item.columns ?? {}), agentStage: nextVersion > 1 ? "revised" : "draft_ready" },
      })
      .where(eq(contentItems.id, item.id));

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_version",
      entityId: created.id,
      change: "saved_version",
      after: { contentId: item.id, version: nextVersion, status: nextStatus },
    });

    return {
      id: created.id,
      contentId: created.contentId,
      draftId: created.draftId ?? null,
      body: created.body,
      version: created.version,
      createdAt: created.createdAt,
    };
  });
}
