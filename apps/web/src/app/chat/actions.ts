"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@athena/db";
import { deleteThread, renameThread } from "@athena/core/assistant";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";

export async function renameThreadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await renameThread(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      threadId: str(fd, "threadId"),
      title: str(fd, "title"),
    });
    revalidatePath("/chat");
    revalidatePath("/home");
    return { ok: true, message: "Renamed." };
  });
}

export async function deleteThreadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await deleteThread(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      threadId: str(fd, "threadId"),
    });
    revalidatePath("/chat");
    revalidatePath("/home");
    redirect("/chat");
  });
}
