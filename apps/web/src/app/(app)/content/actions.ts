"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  CONTENT_STATUSES,
  CMS_PROVIDERS,
  type ContentStatus,
  type CmsProvider,
  createContentItem,
  importContentFromUrl,
  updateContentItem,
  deleteContentItem,
  generateContentBrief,
  approveContentBrief,
  generateContentDraft,
  reviseWithAthena,
  saveContentVersion,
  upsertPublishTarget,
  deletePublishTarget,
  publishContentItem,
  markContentPublished,
  contentWritingContext,
  CMS_FIELDS,
  isDirect,
} from "@athena/core/content";
import { getSettingsContext } from "@/lib/settings-context";
import { fetchPageHtml } from "@/lib/page-fetch";
import { integrationKey } from "@/lib/integrations";
import { cmsRequest } from "@/lib/cms-request";
import { writeBrief, writeDraft, writeRevision, writtenBy } from "@/lib/content-writer";
import { contentLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = contentLimiter(userId);
  if (!r.ok) {
    return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.` };
  }
  return null;
}

export async function createContentItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const title = String(formData.get("title") ?? "").trim();
    const targetUrl = String(formData.get("targetUrl") ?? "").trim() || null;
    const promptId = String(formData.get("promptId") ?? "").trim() || null;
    const rawStatus = String(formData.get("status") ?? "idea").trim();
    const status: ContentStatus = (CONTENT_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as ContentStatus)
      : "idea";

    const contentType = String(formData.get("contentType") ?? "").trim() || "Article";
    const targetKeyword = String(formData.get("targetKeyword") ?? "").trim() || title.toLowerCase();
    const persona = String(formData.get("persona") ?? "").trim() || "Product Teams";

    await createContentItem(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      title,
      targetUrl,
      promptId,
      status,
      columns: { contentType, targetKeyword, persona },
    });

    revalidatePath("/content");
    return { ok: true, message: `Content item "${title}" added to grid.` };
  } catch (err) {
    return toActionError(err, "Failed to create content item.");
  }
}

export async function importContentUrlAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const url = String(formData.get("url") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim() || undefined;
    const targetKeyword = String(formData.get("targetKeyword") ?? "").trim() || undefined;
    // the page's own text becomes v1 (fetched with the SSRF-safe fetcher)
    const imported = await importContentFromUrl(db, { actorId: s.user.id, websiteId: s.websiteId, url, title, targetKeyword, page: await fetchPageHtml(url) });
    revalidatePath("/content");
    return { ok: true, message: `Imported "${imported.title}" — the page's text is saved as v1.` };
  } catch (err) {
    return toActionError(err, "Failed to import URL.");
  }
}

export async function updateContentItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const contentId = String(formData.get("contentId") ?? "").trim();
    const title = formData.has("title") ? String(formData.get("title") ?? "").trim() || undefined : undefined;
    const targetUrl = formData.has("targetUrl") ? String(formData.get("targetUrl") ?? "").trim() || null : undefined;
    const rawStatus = formData.get("status");
    const status =
      typeof rawStatus === "string" && (CONTENT_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as ContentStatus)
        : undefined;

    const columns: Record<string, string | number | boolean> = {};
    for (const key of ["contentType", "targetKeyword", "persona", "customColKey", "customColValue"]) {
      if (formData.has(key)) {
        const val = String(formData.get(key) ?? "").trim();
        if (key === "customColKey") {
          const customVal = String(formData.get("customColValue") ?? "").trim();
          if (val) columns[val] = customVal;
        } else if (key !== "customColValue" && val) {
          columns[key] = val;
        }
      }
    }

    await updateContentItem(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
      title,
      targetUrl,
      status,
      columns: Object.keys(columns).length > 0 ? columns : undefined,
    });

    revalidatePath("/content");
    return { ok: true, message: "Content row updated." };
  } catch (err) {
    return toActionError(err, "Failed to update content item.");
  }
}

export async function deleteContentItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const contentId = String(formData.get("contentId") ?? "").trim();
    await deleteContentItem(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
    });
    revalidatePath("/content");
    return { ok: true, message: "Content item removed." };
  } catch (err) {
    return toActionError(err, "Failed to delete content item.");
  }
}

export async function generateBriefAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const ids = { actorId: s.user.id, websiteId: s.websiteId, contentId: String(formData.get("contentId") ?? "").trim() };
    const focusNotes = String(formData.get("focusNotes") ?? "").trim() || undefined;
    const ai = await writeBrief(await contentWritingContext(db, ids), focusNotes);
    await generateContentBrief(db, { ...ids, focusNotes, body: ai.ok ? ai.text : undefined, source: ai.ok ? ai.provider : "template" });
    revalidatePath("/content");
    return { ok: true, message: writtenBy(ai, "Brief") };
  } catch (err) {
    return toActionError(err, "Failed to generate content brief.");
  }
}

export async function approveBriefAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const contentId = String(formData.get("contentId") ?? "").trim();
    const briefId = String(formData.get("briefId") ?? "").trim() || undefined;
    const body = formData.has("body") ? String(formData.get("body") ?? "").trim() || undefined : undefined;

    await approveContentBrief(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
      briefId,
      body,
    });

    revalidatePath("/content");
    return { ok: true, message: "Content brief approved." };
  } catch (err) {
    return toActionError(err, "Failed to approve brief.");
  }
}

export async function generateDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const ids = { actorId: s.user.id, websiteId: s.websiteId, contentId: String(formData.get("contentId") ?? "").trim() };
    const briefId = String(formData.get("briefId") ?? "").trim() || undefined;
    const instructions = String(formData.get("instructions") ?? "").trim() || undefined;
    const ai = await writeDraft(await contentWritingContext(db, ids), instructions);
    const res = await generateContentDraft(db, { ...ids, briefId, instructions, body: ai.ok ? ai.text : undefined, source: ai.ok ? ai.provider : "template" });
    revalidatePath("/content");
    return { ok: true, message: `${writtenBy(ai, "Draft")} Saved as v${res.version.version}.` };
  } catch (err) {
    return toActionError(err, "Failed to generate content draft.");
  }
}

export async function reviseWithAthenaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const ids = { actorId: s.user.id, websiteId: s.websiteId, contentId: String(formData.get("contentId") ?? "").trim() };
    const instruction = String(formData.get("instruction") ?? "").trim() || "Improve clarity and structure";
    const ctx = await contentWritingContext(db, ids);
    const current = (formData.has("body") ? String(formData.get("body") ?? "").trim() : "") || ctx.latestBody;
    if (!current) return { ok: false, error: "Write or generate a draft first, then ask Athena to revise it." };
    const ai = await writeRevision(ctx, current, instruction);
    if (!ai.ok) {
      return { ok: false, error: ai.reason === "unavailable" ? "Revisions need an AI provider, and none is configured. Edit the draft directly instead." : "The AI provider failed. Please try again." };
    }
    const res = await reviseWithAthena(db, { ...ids, instruction, body: ai.text, source: ai.provider });
    revalidatePath("/content");
    return { ok: true, message: `${ai.provider} revised the draft to v${res.version.version} (status: ${res.status}) — review it before publishing.` };
  } catch (err) {
    return toActionError(err, "Failed to revise content with Athena.");
  }
}

export async function saveVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const contentId = String(formData.get("contentId") ?? "").trim();
    const body = String(formData.get("body") ?? "");
    const rawStatus = String(formData.get("status") ?? "").trim();
    const status = (CONTENT_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as ContentStatus)
      : undefined;

    const ver = await saveContentVersion(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
      body,
      status,
    });

    revalidatePath("/content");
    return { ok: true, message: `Saved new version v${ver.version}.` };
  } catch (err) {
    return toActionError(err, "Failed to save content version.");
  }
}

export async function upsertPublishTargetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const rawProvider = String(formData.get("provider") ?? "").trim().toLowerCase();
    if (!(CMS_PROVIDERS as readonly string[]).includes(rawProvider)) return { ok: false, error: "Invalid CMS provider" };
    const provider = rawProvider as CmsProvider;
    // only the fields this CMS needs; empty or masked values keep what is stored
    const fields = isDirect(provider) ? CMS_FIELDS[provider] : [];
    const config = Object.fromEntries(fields.map((f) => [f.key, String(formData.get(f.key) ?? "").trim()]).filter(([, v]) => v));
    const saved = await upsertPublishTarget(db, { actorId: s.user.id, websiteId: s.websiteId, provider, config, secretKey: integrationKey() });
    revalidatePath("/content");
    revalidatePath("/settings/integrations");
    return { ok: true, message: saved.configured ? `${saved.label} connected — secrets are stored encrypted.` : `${saved.label} saved; add the remaining fields to publish.` };
  } catch (err) {
    return toActionError(err, "Failed to save CMS connector.");
  }
}

export async function deletePublishTargetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const targetId = String(formData.get("targetId") ?? "").trim();
    await deletePublishTarget(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      targetId,
    });

    revalidatePath("/content");
    revalidatePath("/settings/integrations");
    return { ok: true, message: "CMS connector disconnected." };
  } catch (err) {
    return toActionError(err, "Failed to disconnect CMS connector.");
  }
}

export async function publishContentItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const contentId = String(formData.get("contentId") ?? "").trim();
    const rawProvider = String(formData.get("provider") ?? "").trim().toLowerCase();
    if (!(CMS_PROVIDERS as readonly string[]).includes(rawProvider)) return { ok: false, error: "Unsupported CMS provider" };
    const res = await publishContentItem(db, { actorId: s.user.id, websiteId: s.websiteId, contentId, provider: rawProvider as CmsProvider, secretKey: integrationKey(), request: cmsRequest });
    revalidatePath("/content");
    return { ok: true, message: res.publishedUrl ? `Published v${res.publishedVersion} to ${res.providerLabel}: ${res.publishedUrl}` : `Published v${res.publishedVersion} to ${res.providerLabel}.` };
  } catch (err) {
    return toActionError(err, "Failed to publish content item.");
  }
}

export async function markPublishedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const contentId = String(formData.get("contentId") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    await markContentPublished(db, { actorId: s.user.id, websiteId: s.websiteId, contentId, url, page: url ? await fetchPageHtml(url) : null });
    revalidatePath("/content");
    return { ok: true, message: "The live page shows this content — marked as published." };
  } catch (err) {
    return toActionError(err, "Failed to verify the live page.");
  }
}

