/* Content hub & publishing */
import { pgTable, uuid, text, timestamp, integer, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { contentStatusEnum, deletedAt, ts } from "./enums";
import { websites } from "./tenancy";
import { prompts } from "./tracking";

export const contentItems = pgTable("content_items", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  title: text().notNull(),
  targetUrl: text(),
  promptId: uuid().references(() => prompts.id),
  status: contentStatusEnum().notNull().default("idea"),
  /** spreadsheet-style custom columns */
  columns: jsonb().$type<Record<string, string | number | boolean>>().default({}),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

export const contentBriefs = pgTable("content_briefs", {
  id: uuid().primaryKey().defaultRandom(),
  contentId: uuid()
    .notNull()
    .references(() => contentItems.id),
  body: text().notNull(),
  approvedAt: timestamp({ withTimezone: true }),
  createdAt: ts().notNull(),
});

export const contentDrafts = pgTable("content_drafts", {
  id: uuid().primaryKey().defaultRandom(),
  contentId: uuid()
    .notNull()
    .references(() => contentItems.id),
  briefId: uuid().references(() => contentBriefs.id),
  body: text().notNull(),
  createdAt: ts().notNull(),
});

export const contentVersions = pgTable("content_versions", {
  id: uuid().primaryKey().defaultRandom(),
  contentId: uuid()
    .notNull()
    .references(() => contentItems.id),
  draftId: uuid().references(() => contentDrafts.id),
  body: text().notNull(),
  version: integer().notNull().default(1),
  createdAt: ts().notNull(),
});

export const publishTargets = pgTable("publish_targets", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  /** wordpress | webflow | contentful | sanity | wix | framer | payload | shopify */
  provider: text().notNull(),
  config: jsonb().$type<Record<string, string>>().notNull().default({}),
  createdAt: ts().notNull(),
});
