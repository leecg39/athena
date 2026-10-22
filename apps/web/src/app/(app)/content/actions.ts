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
} from "@athena/core/content";
import { getSettingsContext } from "@/lib/settings-context";
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

    const imported = await importContentFromUrl(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      url,
      title,
      targetKeyword,
    });

    revalidatePath("/content");
    return { ok: true, message: `Imported "${imported.title}" with baseline brief & v1 draft.` };
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

    const contentId = String(formData.get("contentId") ?? "").trim();
    const focusNotes = String(formData.get("focusNotes") ?? "").trim() || undefined;

    await generateContentBrief(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
      focusNotes,
    });

    revalidatePath("/content");
    return { ok: true, message: "AI Content Brief generated from verified KB facts and internal links." };
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

    const contentId = String(formData.get("contentId") ?? "").trim();
    const briefId = String(formData.get("briefId") ?? "").trim() || undefined;
    const instructions = String(formData.get("instructions") ?? "").trim() || undefined;

    const res = await generateContentDraft(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
      briefId,
      instructions,
    });

    revalidatePath("/content");
    return { ok: true, message: `AI Draft generated and saved as Version v${res.version.version}.` };
  } catch (err) {
    return toActionError(err, "Failed to generate content draft.");
  }
}

export async function reviseWithAthenaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const contentId = String(formData.get("contentId") ?? "").trim();
    const instruction = String(formData.get("instruction") ?? "").trim() || undefined;
    const body = formData.has("body") ? String(formData.get("body") ?? "").trim() || undefined : undefined;

    const res = await reviseWithAthena(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
      instruction,
      body,
    });

    revalidatePath("/content");
    return { ok: true, message: `Athena revised content to v${res.version.version} (status: ${res.status}).` };
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
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const rawProvider = String(formData.get("provider") ?? "").trim().toLowerCase();
    if (!(CMS_PROVIDERS as readonly string[]).includes(rawProvider)) {
      return { ok: false, error: "Invalid CMS provider" };
    }
    const provider = rawProvider as CmsProvider;
    const endpointUrl = String(formData.get("endpointUrl") ?? "").trim();
    const apiToken = String(formData.get("apiToken") ?? "").trim();
    const collection = String(formData.get("collection") ?? "").trim();

    const config: Record<string, string> = {};
    if (endpointUrl) config.endpointUrl = endpointUrl;
    if (apiToken) config.apiToken = apiToken;
    if (collection) config.collection = collection;

    const saved = await upsertPublishTarget(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      provider,
      config,
    });

    revalidatePath("/content");
    revalidatePath("/settings/integrations");
    return { ok: true, message: `${saved.label} CMS connector configured.` };
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
    const rawProvider = String(formData.get("provider") ?? "wordpress").trim().toLowerCase();
    if (!(CMS_PROVIDERS as readonly string[]).includes(rawProvider)) {
      return { ok: false, error: "Unsupported CMS provider" };
    }
    const provider = rawProvider as CmsProvider;
    const targetUrl = String(formData.get("targetUrl") ?? "").trim() || null;

    const res = await publishContentItem(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      contentId,
      provider,
      targetUrl,
    });

    revalidatePath("/content");
    revalidatePath("/settings/integrations");
    return {
      ok: true,
      message: `Published v${res.publishedVersion} to ${res.providerLabel} (${res.publishedUrl}).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to publish content item.");
  }
}
