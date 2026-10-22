/**
 * Ask Athena threads: private to their author, scoped to one website. One
 * answer run per thread at a time (claimRun/finishRun), so a refresh or a
 * second tab cannot produce duplicate replies.
 */
import { z } from "zod";
import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import { type Db, chatThreads, chatMessages, type ChatAttachment, type ChatToolCall } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { DomainError, NotFoundError } from "../org/errors";

export const CHAT_LIMITS = {
  messageChars: 4000,
  attachments: 3,
  attachmentChars: 100_000,
  titleChars: 80,
  historyMessages: 20,
  /** earlier attachments are re-sent to the model as a preview only */
  previewChars: 2_000,
} as const;

/** A run older than this is treated as dead (crashed server, closed tab). */
export const RUN_TIMEOUT_MS = 3 * 60_000;

const TEXT_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
};

const uuid = z.string().uuid();
const messageText = z.string().trim().min(1, "Write a message first").max(CHAT_LIMITS.messageChars, `Messages are limited to ${CHAT_LIMITS.messageChars} characters`);
const attachmentInput = z.object({
  name: z.string().trim().min(1).max(120),
  text: z.string().max(CHAT_LIMITS.attachmentChars, `Attachments are limited to ${CHAT_LIMITS.attachmentChars.toLocaleString("en-US")} characters`),
});
const attachmentsInput = z.array(attachmentInput).max(CHAT_LIMITS.attachments, `Attach at most ${CHAT_LIMITS.attachments} files`).default([]);

export type AttachmentInput = z.input<typeof attachmentInput>;
export type ThreadRow = typeof chatThreads.$inferSelect;
export type MessageRow = typeof chatMessages.$inferSelect;

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
  attachments: ChatAttachment[];
}

export interface ModelTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantReply {
  content: string;
  toolCalls: ChatToolCall[];
  provider: string | null;
  simulated: boolean;
  status: "complete" | "stopped";
}

function toAttachment(a: z.infer<typeof attachmentInput>): ChatAttachment {
  const dot = a.name.lastIndexOf(".");
  const type = dot > 0 ? TEXT_TYPES[a.name.slice(dot + 1).toLowerCase()] : undefined;
  if (!type) throw new DomainError("Only text files (TXT, MD, CSV, TSV, JSON) can be attached");
  if (a.text.includes("\u0000")) throw new DomainError(`${a.name} looks like a binary file`);
  return { name: a.name, type, size: a.text.length, text: a.text };
}

function parseMessage(input: { message: string; attachments?: AttachmentInput[] }) {
  return { content: messageText.parse(input.message), attachments: attachmentsInput.parse(input.attachments).map(toAttachment) };
}

function titleFrom(message: string): string {
  const line = message.split("\n")[0].replace(/\s+/g, " ").trim();
  return line.length > CHAT_LIMITS.titleChars ? `${line.slice(0, CHAT_LIMITS.titleChars - 1)}…` : line;
}

/** Chat reads the website's analytics, so it needs read access to it. */
function access(db: Db, actorId: string, websiteId: string) {
  return requireWebsitePermission(db, actorId, websiteId, "prompts:read");
}

async function ownedThread(db: Db, input: { actorId: string; websiteId: string; threadId: string }): Promise<ThreadRow> {
  if (!z.object({ actorId: uuid, websiteId: uuid, threadId: uuid }).safeParse(input).success) throw new NotFoundError("Chat not found");
  await access(db, input.actorId, input.websiteId);
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, input.threadId), eq(chatThreads.userId, input.actorId), eq(chatThreads.websiteId, input.websiteId), isNull(chatThreads.deletedAt)));
  if (!thread) throw new NotFoundError("Chat not found");
  return thread;
}

export async function createThread(db: Db, input: { actorId: string; websiteId: string; message: string; attachments?: AttachmentInput[] }) {
  const { content, attachments } = parseMessage(input);
  const site = await access(db, input.actorId, input.websiteId);
  return db.transaction(async (tx) => {
    const [thread] = await tx.insert(chatThreads).values({ websiteId: site.id, userId: input.actorId, title: titleFrom(content) }).returning();
    const [message] = await tx.insert(chatMessages).values({ threadId: thread.id, role: "user", content, attachments }).returning();
    return { thread, message };
  });
}

export async function appendUserMessage(db: Db, input: { actorId: string; websiteId: string; threadId: string; message: string; attachments?: AttachmentInput[] }) {
  const { content, attachments } = parseMessage(input);
  const thread = await ownedThread(db, input);
  const now = new Date();
  const stale = new Date(now.getTime() - RUN_TIMEOUT_MS);
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .update(chatThreads)
      .set({ updatedAt: now })
      .where(and(eq(chatThreads.id, thread.id), isNull(chatThreads.deletedAt), or(isNull(chatThreads.runningSince), lt(chatThreads.runningSince, stale))))
      .returning({ id: chatThreads.id });
    if (!locked) throw new DomainError("Athena is still answering. Wait for the reply or stop it first.");
    const [message] = await tx.insert(chatMessages).values({ threadId: thread.id, role: "user", content, attachments }).returning();
    return message;
  });
}

export async function getThread(db: Db, input: { actorId: string; websiteId: string; threadId: string }): Promise<{ thread: ThreadRow; messages: MessageRow[] }> {
  const thread = await ownedThread(db, input);
  const messages = await db.select().from(chatMessages).where(eq(chatMessages.threadId, thread.id)).orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return { thread, messages };
}

export async function listThreads(db: Db, input: { actorId: string; websiteId: string; limit?: number }) {
  await access(db, input.actorId, input.websiteId);
  return db
    .select({ id: chatThreads.id, title: chatThreads.title, updatedAt: chatThreads.updatedAt })
    .from(chatThreads)
    .where(and(eq(chatThreads.userId, input.actorId), eq(chatThreads.websiteId, input.websiteId), isNull(chatThreads.deletedAt)))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 30, 1), 100));
}

export async function renameThread(db: Db, input: { actorId: string; websiteId: string; threadId: string; title: string }): Promise<void> {
  const title = z.string().trim().min(1).max(CHAT_LIMITS.titleChars).parse(input.title);
  const thread = await ownedThread(db, input);
  await db.update(chatThreads).set({ title }).where(eq(chatThreads.id, thread.id));
}

export async function deleteThread(db: Db, input: { actorId: string; websiteId: string; threadId: string }): Promise<void> {
  const thread = await ownedThread(db, input);
  await db.update(chatThreads).set({ deletedAt: new Date(), runningSince: null }).where(eq(chatThreads.id, thread.id));
}

/**
 * Marks the thread as answering (atomically; a dead run is reclaimed after
 * RUN_TIMEOUT_MS), optionally appends a follow-up user message inside the same
 * transaction, and returns the recent history to answer.
 */
export async function claimRun(
  db: Db,
  input: { actorId: string; websiteId: string; threadId: string; message?: string; attachments?: AttachmentInput[]; now?: Date },
) {
  const parsed = input.message !== undefined ? parseMessage({ message: input.message, attachments: input.attachments }) : null;
  const thread = await ownedThread(db, input);
  const now = input.now ?? new Date();
  const stale = new Date(now.getTime() - RUN_TIMEOUT_MS);

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(chatThreads)
      .set({ runningSince: now, ...(parsed ? { updatedAt: now } : {}) })
      .where(and(eq(chatThreads.id, thread.id), isNull(chatThreads.deletedAt), or(isNull(chatThreads.runningSince), lt(chatThreads.runningSince, stale))))
      .returning();
    if (!claimed) throw new DomainError("Athena is already answering in this chat");
    if (parsed) {
      await tx.insert(chatMessages).values({ threadId: thread.id, role: "user", content: parsed.content, attachments: parsed.attachments });
    }
    const recent = await tx
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread.id))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(CHAT_LIMITS.historyMessages);
    const history: HistoryItem[] = [...recent].reverse().map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      attachments: m.attachments,
    }));
    if (history.at(-1)?.role !== "user") {
      throw new DomainError("There is nothing to answer yet");
    }
    return { thread: claimed, history, claimedAt: now };
  });
}

/** Stores the reply only if this run still owns the thread; returns whether it did. */
export async function finishRun(db: Db, input: { threadId: string; claimedAt: Date; reply: AssistantReply }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [mine] = await tx
      .update(chatThreads)
      .set({ runningSince: null, updatedAt: new Date() })
      .where(and(eq(chatThreads.id, input.threadId), eq(chatThreads.runningSince, input.claimedAt), isNull(chatThreads.deletedAt)))
      .returning({ id: chatThreads.id });
    if (!mine) return false;
    await tx.insert(chatMessages).values({ threadId: input.threadId, role: "assistant", ...input.reply });
    return true;
  });
}

/** Ends a run without a reply (failure, or stopped before any text). */
export async function releaseRun(db: Db, input: { threadId: string; claimedAt: Date }): Promise<void> {
  await db
    .update(chatThreads)
    .set({ runningSince: null })
    .where(and(eq(chatThreads.id, input.threadId), eq(chatThreads.runningSince, input.claimedAt)));
}

function attachmentBlock(a: ChatAttachment, full: boolean): string {
  const body = full ? a.text : a.text.slice(0, CHAT_LIMITS.previewChars);
  const omitted = a.text.length - body.length;
  const note = omitted > 0 ? `\n[${omitted} more characters of this earlier attachment omitted]` : "";
  return `<attachment name="${a.name.replace(/["<>]/g, "'")}" type="${a.type}">\n${body}${note}\n</attachment>`;
}

/**
 * Stored history → model turns: starts with a user turn, merges consecutive
 * same-role turns, and re-sends full attachments only for the latest message.
 */
export function historyForModel(history: HistoryItem[]): ModelTurn[] {
  const lastUser = history.map((m) => m.role).lastIndexOf("user");
  const turns = history.map((m, i) => ({
    role: m.role,
    content: [m.content, ...m.attachments.map((a) => attachmentBlock(a, i === lastUser))].join("\n\n"),
  }));
  const start = turns.findIndex((t) => t.role === "user");
  return turns.slice(Math.max(start, 0)).reduce<ModelTurn[]>((acc, t) => {
    const prev = acc.at(-1);
    return prev && prev.role === t.role ? [...acc.slice(0, -1), { role: t.role, content: `${prev.content}\n\n${t.content}` }] : [...acc, t];
  }, []);
}
