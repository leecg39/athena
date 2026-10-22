"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  AD_SURFACES,
  type AdSurface,
  captureSponsoredAds,
  recordAdImpression,
  deleteAdImpression,
} from "@athena/core/commerce";
import { getSettingsContext } from "@/lib/settings-context";
import { commerceLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = commerceLimiter(userId);
  if (!r.ok) {
    return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.` };
  }
  return null;
}

export async function captureSponsoredAdsAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const res = await captureSponsoredAds(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
    });

    revalidatePath("/ads");
    return {
      ok: true,
      message: `Sponsored ad scan complete (${res.captured} new ads captured, ${res.updated} refreshed across ChatGPT, AI Mode & AI Overview).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to scan sponsored ads.");
  }
}

export async function recordAdImpressionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const rawSurface = String(formData.get("surface") ?? "chatgpt").trim().toLowerCase();
    const surface: AdSurface = (AD_SURFACES as readonly string[]).includes(rawSurface)
      ? (rawSurface as AdSurface)
      : "chatgpt";
    const advertiser = String(formData.get("advertiser") ?? "").trim();
    const adText = String(formData.get("adText") ?? "").trim();
    const rawPromptId = String(formData.get("promptId") ?? "").trim();
    const promptId = rawPromptId && rawPromptId !== "none" ? rawPromptId : null;

    await recordAdImpression(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      promptId,
      surface,
      advertiser,
      adText,
    });

    revalidatePath("/ads");
    return {
      ok: true,
      message: `Recorded sponsored ad capture for "${advertiser}" on ${surface}.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to record sponsored ad capture.");
  }
}

export async function deleteAdImpressionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const impressionId = String(formData.get("impressionId") ?? "").trim();
    await deleteAdImpression(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      impressionId,
    });

    revalidatePath("/ads");
    return {
      ok: true,
      message: "Removed sponsored ad capture.",
    };
  } catch (err) {
    return toActionError(err, "Failed to remove sponsored ad capture.");
  }
}
