"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import {
  runOracleScan,
  updateOracleFindingStatus,
  resolveFindingWithFact,
  type OracleFindingStatus,
} from "@athena/core/knowledge";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";
import { oracleLimiter } from "@/lib/limits";

export async function runOracleScanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    if (!oracleLimiter(ws.user.id).ok) {
      return { ok: false, error: "Oracle scan was run many times recently. Please wait a few minutes." };
    }
    const rawDays = Number(str(fd, "days") || "30");
    const days = rawDays === 7 || rawDays === 14 || rawDays === 90 ? rawDays : 30;
    const r = await runOracleScan(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      days,
    });
    revalidatePath("/oracle");
    revalidatePath("/knowledge-base");
    if (r.created === 0 && r.updated === 0 && r.skipped === 0) {
      return { ok: true, message: `Scan complete over last ${days} days: no inaccuracies or conflicts detected.` };
    }
    const parts: string[] = [];
    if (r.created > 0) parts.push(`${r.created} new`);
    if (r.updated > 0) parts.push(`${r.updated} updated`);
    if (r.skipped > 0) parts.push(`${r.skipped} resolved/dismissed skipped`);
    return { ok: true, message: `Oracle scan complete (${parts.join(", ")}).` };
  });
}

export async function updateOracleStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    const findingId = str(fd, "findingId");
    const status = str(fd, "status") as OracleFindingStatus;
    const row = await updateOracleFindingStatus(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      findingId,
      status,
    });
    revalidatePath("/oracle");
    return { ok: true, message: `Finding status updated to ${row.status}.` };
  });
}

export async function resolveWithFactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    const res = await resolveFindingWithFact(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      findingId: str(fd, "findingId"),
      pillarId: str(fd, "pillarId") || undefined,
      claim: str(fd, "claim"),
      sourceUrl: str(fd, "sourceUrl") || null,
    });
    revalidatePath("/oracle");
    revalidatePath("/knowledge-base");
    return { ok: true, message: `Resolved finding and saved verified KB fact "${res.fact.claim}".` };
  });
}
