"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { createCompetitor, updateCompetitor, deleteCompetitor } from "@athena/core/competitors";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";
import { scheduleReanalysis } from "@/lib/collection";
import { competitorLimiter } from "@/lib/limits";

type Workspace = Awaited<ReturnType<typeof requireWorkspace>>;

/** Shared flow: limit, mutate, then re-analyse stored answers in the background. */
async function change(mutate: (ws: Workspace) => Promise<boolean>, message: string): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    if (!competitorLimiter(ws.user.id).ok) return { ok: false, error: "Competitors were changed many times recently. Please wait a few minutes." };
    if (!(await mutate(ws))) return { ok: true, message: "No changes." };
    await scheduleReanalysis(ws.websiteId);
    revalidatePath("/competitors");
    return { ok: true, message: `${message} Past answers are being re-analyzed.` };
  });
}

export async function addCompetitorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return change(async (ws) => {
    await createCompetitor(db, { actorId: ws.user.id, websiteId: ws.websiteId, name: str(fd, "name"), domain: str(fd, "domain") });
    return true;
  }, "Competitor added.");
}

export async function editCompetitorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return change(async (ws) => {
    const r = await updateCompetitor(db, { actorId: ws.user.id, websiteId: ws.websiteId, competitorId: str(fd, "competitorId"), name: str(fd, "name"), domain: str(fd, "domain") });
    return r.changed;
  }, "Saved.");
}

export async function deleteCompetitorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return change(async (ws) => {
    await deleteCompetitor(db, { actorId: ws.user.id, websiteId: ws.websiteId, competitorId: str(fd, "competitorId") });
    return true;
  }, "Removed.");
}
