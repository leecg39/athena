"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  PITCH_KINDS,
  type PitchKind,
  createPitch,
  deletePitch,
  regeneratePitchRewrite,
} from "@athena/core/pitches";
import { getSettingsContext } from "@/lib/settings-context";
import { pitchesLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = pitchesLimiter(userId);
  if (!r.ok) {
    return {
      ok: false,
      error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.`,
    };
  }
  return null;
}

export async function createPitchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
    const brandName = String(formData.get("brandName") ?? "").trim() || undefined;
    const rawKind = String(formData.get("kind") ?? "visibility").trim();
    const kind: PitchKind = (PITCH_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as PitchKind)
      : "visibility";
    const industry = String(formData.get("industry") ?? "").trim() || undefined;
    const targetPageUrl = String(formData.get("targetPageUrl") ?? "").trim() || undefined;
    const existingCopy = String(formData.get("existingCopy") ?? "").trim() || undefined;
    const rawPrompts = String(formData.get("targetPrompts") ?? "").trim();
    const targetPrompts = rawPrompts
      ? rawPrompts
          .split(/\n|,/)
          .map((p) => p.trim())
          .filter(Boolean)
      : undefined;

    const created = await createPitch(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      websiteUrl,
      brandName,
      kind,
      industry,
      targetPageUrl,
      existingCopy,
      targetPrompts,
    });

    revalidatePath("/pitches");
    return {
      ok: true,
      message: `Generated ${
        created.kind === "content" ? "AEO Content Rewrite Pitch" : "AI Search Visibility Pitch"
      } for ${created.brandName} (${created.sharePath}).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to generate pitch report.");
  }
}

export async function regeneratePitchRewriteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const pitchId = String(formData.get("pitchId") ?? "").trim();
    const targetPageUrl = String(formData.get("targetPageUrl") ?? "").trim() || undefined;
    const focusPrompt = String(formData.get("focusPrompt") ?? "").trim() || undefined;
    const existingCopy = String(formData.get("existingCopy") ?? "").trim() || undefined;

    const updated = await regeneratePitchRewrite(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      pitchId,
      targetPageUrl,
      focusPrompt,
      existingCopy,
    });

    revalidatePath("/pitches");
    revalidatePath(`/report/${updated.shareId}`);
    revalidatePath(`/report/content/${updated.shareId}`);
    return {
      ok: true,
      message: `Updated AEO Content Rewrite Pitch for ${updated.brandName} (+${updated.payload.contentRewrite.projectedCitationLiftPct}% projected citation lift).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to update content rewrite pitch.");
  }
}

export async function deletePitchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const pitchId = String(formData.get("pitchId") ?? "").trim();
    await deletePitch(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      pitchId,
    });

    revalidatePath("/pitches");
    return {
      ok: true,
      message: "Deleted pitch report.",
    };
  } catch (err) {
    return toActionError(err, "Failed to delete pitch report.");
  }
}
