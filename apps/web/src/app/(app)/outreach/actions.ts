"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  OUTREACH_STATUSES,
  type OutreachStatus,
  discoverOutreachOpportunities,
  createOutreachOpportunity,
  findOutreachAuthor,
  generateOutreachEmailDraft,
  updateOutreachStatus,
  updateOutreachOpportunity,
  deleteOutreachOpportunity,
} from "@athena/core/outreach";
import { getSettingsContext } from "@/lib/settings-context";
import { outreachLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = outreachLimiter(userId);
  if (!r.ok) {
    return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.` };
  }
  return null;
}

export async function discoverOutreachAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const days = Number(formData.get("days") ?? 30) || 30;
    const res = await discoverOutreachOpportunities(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      days,
    });

    revalidatePath("/outreach");
    return {
      ok: true,
      message: `Outreach scan complete (${res.created} new opportunities discovered, ${res.updated} refreshed).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to discover outreach opportunities.");
  }
}

export async function createOutreachOpportunityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const url = String(formData.get("url") ?? "").trim();
    const citationPct = Number(formData.get("citationPct") ?? 14.5) || 14.5;
    const estimatedImpressions = Number(formData.get("estimatedImpressions") ?? 18000) || 18000;
    const citations = Number(formData.get("citations") ?? 12) || 12;
    const notes = String(formData.get("notes") ?? "").trim() || null;

    const created = await createOutreachOpportunity(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      url,
      citationPct,
      estimatedImpressions,
      citations,
      notes,
    });

    revalidatePath("/outreach");
    return {
      ok: true,
      message: `Added citation opportunity "${created.domain}" to New column.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to add outreach opportunity.");
  }
}

export async function findOutreachAuthorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const opportunityId = String(formData.get("opportunityId") ?? "").trim();
    const updated = await findOutreachAuthor(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      opportunityId,
    });

    revalidatePath("/outreach");
    return {
      ok: true,
      message: `Found editorial contact: ${updated.authorName} <${updated.authorEmail}>.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to find author.");
  }
}

export async function generateOutreachDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const opportunityId = String(formData.get("opportunityId") ?? "").trim();
    const angle = String(formData.get("angle") ?? "").trim() || undefined;

    const updated = await generateOutreachEmailDraft(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      opportunityId,
      angle,
      advanceToTodo: true,
    });

    revalidatePath("/outreach");
    return {
      ok: true,
      message: `Generated personalized pitch draft for ${updated.authorName} (${updated.domain}) and moved to ${updated.status.toUpperCase()}.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to generate outreach email draft.");
  }
}

export async function updateOutreachStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const opportunityId = String(formData.get("opportunityId") ?? "").trim();
    const rawStatus = String(formData.get("status") ?? "").trim().toLowerCase();
    if (!(OUTREACH_STATUSES as readonly string[]).includes(rawStatus)) {
      return { ok: false, error: "Invalid outreach status" };
    }

    const updated = await updateOutreachStatus(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      opportunityId,
      status: rawStatus as OutreachStatus,
    });

    revalidatePath("/outreach");
    return {
      ok: true,
      message: `Moved "${updated.domain}" to ${updated.status.toUpperCase()}.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to update outreach status.");
  }
}

export async function updateOutreachDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const opportunityId = String(formData.get("opportunityId") ?? "").trim();
    const authorName = formData.has("authorName") ? String(formData.get("authorName") ?? "").trim() || null : undefined;
    const authorEmail = formData.has("authorEmail") ? String(formData.get("authorEmail") ?? "").trim() || null : undefined;
    const emailDraft = formData.has("emailDraft") ? String(formData.get("emailDraft") ?? "").trim() || null : undefined;
    const notes = formData.has("notes") ? String(formData.get("notes") ?? "").trim() || null : undefined;

    await updateOutreachOpportunity(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      opportunityId,
      authorName,
      authorEmail,
      emailDraft,
      notes,
    });

    revalidatePath("/outreach");
    return {
      ok: true,
      message: "Outreach opportunity contact & pitch saved.",
    };
  } catch (err) {
    return toActionError(err, "Failed to update outreach details.");
  }
}

export async function deleteOutreachOpportunityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const opportunityId = String(formData.get("opportunityId") ?? "").trim();
    await deleteOutreachOpportunity(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      opportunityId,
    });
    revalidatePath("/outreach");
    return { ok: true, message: "Outreach opportunity removed." };
  } catch (err) {
    return toActionError(err, "Failed to delete outreach opportunity.");
  }
}
