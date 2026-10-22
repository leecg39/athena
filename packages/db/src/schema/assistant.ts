/* Ask Athena: per-user chat threads grounded in the workspace's own data */
import { pgTable, uuid, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { ts, deletedAt } from "./enums";
import { users, websites } from "./tenancy";

export interface ChatAttachment {
  name: string;
  /** MIME type as reported by the browser (text formats only) */
  type: string;
  size: number;
  text: string;
}

export interface ChatToolCall {
  name: string;
  ok: boolean;
}

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    /** set while an assistant reply is being generated: one run per thread */
    runningSince: timestamp({ withTimezone: true }),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [index("chat_threads_owner_idx").on(t.userId, t.websiteId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    threadId: uuid()
      .notNull()
      .references(() => chatThreads.id),
    /** user | assistant */
    role: text().notNull(),
    content: text().notNull(),
    attachments: jsonb().$type<ChatAttachment[]>().notNull().default([]),
    toolCalls: jsonb().$type<ChatToolCall[]>().notNull().default([]),
    provider: text(),
    simulated: boolean().notNull().default(false),
    /** complete | error | stopped */
    status: text().notNull().default("complete"),
    createdAt: ts().notNull(),
  },
  (t) => [index("chat_messages_thread_idx").on(t.threadId, t.createdAt)],
);
