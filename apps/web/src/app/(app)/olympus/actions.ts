"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@athena/db";
import { createView, deleteView, parseDashboardState, stateToSearchParams } from "@athena/core/analytics";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";

export async function saveViewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    const state = parseDashboardState(Object.fromEntries(new URLSearchParams(str(fd, "state"))));
    await createView(db, { actorId: ws.user.id, websiteId: ws.websiteId, name: str(fd, "name"), state });
    revalidatePath("/olympus");
    return { ok: true, message: "View saved" };
  });
}

export async function deleteViewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async () => {
    const ws = await requireWorkspace();
    await deleteView(db, { actorId: ws.user.id, websiteId: ws.websiteId, viewId: str(fd, "viewId") });
  });
  if (r.ok) redirect(`/olympus?${stateToSearchParams(parseDashboardState({})).toString()}`);
  return r;
}
