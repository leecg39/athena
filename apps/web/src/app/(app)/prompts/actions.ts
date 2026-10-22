"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import {
  createPrompt,
  updatePrompt,
  bulkPromptAction,
  createTopic,
  renameTopic,
  deleteTopic,
  createTag,
  deleteTag,
  createPersona,
  deletePersona,
  createLocation,
  deleteLocation,
  createSchedule,
  updateScheduleCadence,
  archiveSchedule,
  type PromptCandidate,
} from "@athena/core/prompts";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";
import { runDiscovery, type DiscoveryResult } from "@/lib/discovery";
import { discoveryLimiter } from "@/lib/limits";

async function c() {
  const ws = await requireWorkspace();
  return { actorId: ws.user.id, websiteId: ws.websiteId };
}
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const done = (message: string): ActionState => {
  revalidatePath("/prompts");
  return { ok: true, message };
};

export async function addPromptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await createPrompt(db, {
      ...(await c()),
      text: str(fd, "text"),
      topicId: opt(fd, "topicId"),
      personaId: opt(fd, "personaId"),
      locationId: opt(fd, "locationId"),
      tagIds: fd.getAll("tagIds").map(String).filter(Boolean),
    });
    return done("Prompt added");
  });
}

export async function editPromptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updatePrompt(db, {
      ...(await c()),
      promptId: str(fd, "promptId"),
      text: str(fd, "text"),
      topicId: opt(fd, "topicId"),
      personaId: opt(fd, "personaId"),
      locationId: opt(fd, "locationId"),
    });
    return done("Prompt updated");
  });
}

export async function bulkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) return { ok: false, error: "Select at least one prompt" };
    const action = str(fd, "action") as Parameters<typeof bulkPromptAction>[1]["action"];
    const r = await bulkPromptAction(db, { ...(await c()), promptIds: ids, action, value: opt(fd, "value") });
    return done(`${r.affected} prompt(s) updated`);
  });
}

export async function addTopicAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await createTopic(db, { ...(await c()), name: str(fd, "name"), description: str(fd, "description") });
    return done("Topic created");
  });
}
export async function renameTopicAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await renameTopic(db, { ...(await c()), topicId: str(fd, "topicId"), name: str(fd, "name") });
    return done("Renamed");
  });
}
export async function deleteTopicAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await deleteTopic(db, { ...(await c()), topicId: str(fd, "topicId") });
    return done("Topic deleted");
  });
}
export async function addTagAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await createTag(db, { ...(await c()), name: str(fd, "name"), color: str(fd, "color") || undefined });
    return done("Tag created");
  });
}
export async function deleteTagAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await deleteTag(db, { ...(await c()), tagId: str(fd, "tagId") });
    return done("Tag deleted");
  });
}
export async function addPersonaAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await createPersona(db, { ...(await c()), name: str(fd, "name"), description: str(fd, "description") });
    return done("Persona created");
  });
}
export async function deletePersonaAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await deletePersona(db, { ...(await c()), personaId: str(fd, "personaId") });
    return done("Persona deleted");
  });
}
export async function addLocationAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await createLocation(db, { ...(await c()), name: str(fd, "name"), country: str(fd, "country") });
    return done("Location added");
  });
}
export async function deleteLocationAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await deleteLocation(db, { ...(await c()), locationId: str(fd, "locationId") });
    return done("Location removed");
  });
}
export async function addScheduleAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await createSchedule(db, { ...(await c()), name: str(fd, "name"), cadence: str(fd, "cadence") });
    return done("Schedule created");
  });
}
export async function cadenceAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await updateScheduleCadence(db, { ...(await c()), scheduleId: str(fd, "scheduleId"), cadence: str(fd, "cadence") });
    return done("Cadence updated");
  });
}
export async function archiveScheduleAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    await archiveSchedule(db, { ...(await c()), scheduleId: str(fd, "scheduleId") });
    return done("Schedule archived");
  });
}

export interface DiscoverState {
  ok: boolean;
  error?: string;
  result?: DiscoveryResult;
}

export async function discoverAction(): Promise<DiscoverState> {
  try {
    const ws = await requireWorkspace();
    if (!discoveryLimiter(ws.user.id).ok) return { ok: false, error: "Discovery was run many times recently. Please wait a few minutes." };
    return { ok: true, result: await runDiscovery(ws) };
  } catch (err) {
    console.error("[discover] failed", err);
    return { ok: false, error: "Discovery failed. Please try again." };
  }
}

/** Track the selected candidates ("source|volume|text"). */
export async function trackCandidatesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await c();
    const picked: PromptCandidate[] = fd.getAll("candidate").map(String).map((v) => {
      const [source, volume, ...rest] = v.split("|");
      return { source: source as PromptCandidate["source"], volume: Number(volume) || 0, text: rest.join("|") };
    });
    if (!picked.length) return { ok: false, error: "Select at least one prompt" };
    let added = 0;
    const errors: string[] = [];
    for (const p of picked) {
      try {
        await createPrompt(db, { ...ctx, text: p.text, volumeEstimate: p.source === "search_console" ? p.volume : 0 });
        added++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        if (errors.length && /limit/i.test(errors.at(-1) ?? "")) break;
      }
    }
    revalidatePath("/prompts");
    if (!added) return { ok: false, error: errors[0] ?? "Nothing added" };
    return { ok: true, message: `${added} prompt(s) now tracked${errors.length ? ` · ${errors.length} skipped (${errors[0]})` : ""}` };
  });
}
