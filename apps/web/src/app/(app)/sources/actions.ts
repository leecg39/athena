"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { setSourceOverride, removeSourceOverride } from "@athena/core/sources";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";

export async function setSourceTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await setSourceOverride(db, { actorId: ws.user.id, websiteId: ws.websiteId, pattern: str(fd, "pattern"), type: str(fd, "type") });
    revalidatePath("/sources");
    return { ok: true, message: "Source type saved" };
  });
}

export async function removeSourceTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await removeSourceOverride(db, { actorId: ws.user.id, websiteId: ws.websiteId, pattern: str(fd, "pattern") });
    revalidatePath("/sources");
    return { ok: true, message: "Override removed" };
  });
}
