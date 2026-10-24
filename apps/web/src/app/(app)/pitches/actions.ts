"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { configuredAdapters } from "@athena/llm";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import { PITCH_KINDS, type PitchKind, createPitch, deletePitch, writePitchRewrite } from "@athena/core/pitches";
import { getSettingsContext } from "@/lib/settings-context";
import { writePitchCopy } from "@/lib/pitch-writer";
import { pitchesLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) return { ok: false, error: err.message };
  console.error("[pitches] action failed", err);
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = pitchesLimiter(userId);
  return r.ok ? null : { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.` };
}

const lines = (v: FormDataEntryValue | null) => String(v ?? "").split(/\n/).map((x) => x.trim()).filter(Boolean);
const list = (v: FormDataEntryValue | null) => String(v ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
const text = (v: FormDataEntryValue | null) => String(v ?? "").trim() || undefined;

export async function createPitchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const rawKind = String(formData.get("kind") ?? "visibility");
    const kind: PitchKind = (PITCH_KINDS as readonly string[]).includes(rawKind) ? (rawKind as PitchKind) : "visibility";
    const created = await createPitch(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      websiteUrl: String(formData.get("websiteUrl") ?? ""),
      brandName: text(formData.get("brandName")),
      industry: text(formData.get("industry")),
      kind,
      prompts: lines(formData.get("prompts")),
      competitors: list(formData.get("competitors")),
      collectors: configuredAdapters(),
    });
    revalidatePath("/pitches");
    return { ok: true, message: `Pitch for ${created.brandName} measured from ${created.payload?.totals.answers ?? 0} AI answers.` };
  } catch (err) {
    return toActionError(err, "Failed to create the pitch.");
  }
}

export async function writePitchRewriteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const updated = await writePitchRewrite(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      pitchId: String(formData.get("pitchId") ?? ""),
      existingCopy: String(formData.get("existingCopy") ?? ""),
      targetPageUrl: text(formData.get("targetPageUrl")),
      focusPrompt: text(formData.get("focusPrompt")),
      writer: writePitchCopy,
    });
    revalidatePath("/pitches");
    revalidatePath(`/report/${updated.shareId}`);
    revalidatePath(`/report/content/${updated.shareId}`);
    return { ok: true, message: `Rewrite for ${updated.brandName} written by ${updated.payload?.rewrite?.writtenBy ?? "the AI provider"} — review it before sharing.` };
  } catch (err) {
    return toActionError(err, "Failed to write the rewrite.");
  }
}

export async function deletePitchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    await deletePitch(db, { actorId: s.user.id, organizationId: s.organizationId, pitchId: String(formData.get("pitchId") ?? "") });
    revalidatePath("/pitches");
    return { ok: true, message: "Deleted pitch report." };
  } catch (err) {
    return toActionError(err, "Failed to delete pitch report.");
  }
}
