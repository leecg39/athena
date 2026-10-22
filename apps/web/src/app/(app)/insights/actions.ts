"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { generateInsights, updateInsightStatus, type InsightStatus } from "@athena/core/insights";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";
import { insightsLimiter } from "@/lib/limits";

export async function generateInsightsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    if (!insightsLimiter(ws.user.id).ok) {
      return { ok: false, error: "Insights were refreshed many times recently. Please wait a few minutes." };
    }
    const rawDays = Number(str(fd, "days") || "30");
    const days = rawDays === 7 || rawDays === 14 || rawDays === 90 ? rawDays : 30;
    const r = await generateInsights(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      days,
    });
    revalidatePath("/insights");
    if (r.created === 0 && r.updated === 0 && r.skipped === 0) {
      return { ok: true, message: `No insights found over the last ${days} days. Collect AI answers first.` };
    }
    const parts: string[] = [];
    if (r.created > 0) parts.push(`${r.created} new`);
    if (r.updated > 0) parts.push(`${r.updated} updated`);
    if (r.skipped > 0) parts.push(`${r.skipped} resolved/discarded skipped`);
    return { ok: true, message: `Insights refreshed (${parts.join(", ")}).` };
  });
}

export async function updateInsightStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    const insightId = str(fd, "insightId");
    const status = str(fd, "status") as InsightStatus;
    const row = await updateInsightStatus(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      insightId,
      status,
    });
    revalidatePath("/insights");
    const label = row.status === "resolved" ? "marked as resolved" : row.status === "discarded" ? "discarded" : "reopened";
    return { ok: true, message: `"${row.title}" ${label}.` };
  });
}
