"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import { connectSlackWebhook, disconnectSlack } from "@athena/core/reports";
import { getSettingsContext } from "@/lib/settings-context";
import { integrationKey } from "@/lib/integrations";
import { reportsLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function fail(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) return { ok: false, error: err.message };
  console.error("[integrations] slack action failed", err);
  return { ok: false, error: fallback };
}

export async function connectSlackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = reportsLimiter(s.user.id);
    if (!limited.ok) return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(limited.retryAfterMs / 1000)}s.` };
    await connectSlackWebhook(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      webhookUrl: String(formData.get("webhookUrl") ?? ""),
      channel: String(formData.get("channel") ?? "").trim() || null,
      secretKey: integrationKey(),
    });
    revalidatePath("/settings/integrations");
    revalidatePath("/reports");
    return { ok: true, message: "Slack webhook connected." };
  } catch (err) {
    return fail(err, "Failed to connect Slack.");
  }
}

export async function disconnectSlackAction(_prev: ActionState): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    await disconnectSlack(db, { actorId: s.user.id, websiteId: s.websiteId });
    revalidatePath("/settings/integrations");
    revalidatePath("/reports");
    return { ok: true, message: "Slack disconnected." };
  } catch (err) {
    return fail(err, "Failed to disconnect Slack.");
  }
}
