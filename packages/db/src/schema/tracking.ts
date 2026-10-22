/* Tracking: topics / prompts / personas / locations / competitors */
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { deletedAt, promptStatusEnum, promptTypeEnum, scheduleKindEnum, ts } from "./enums";
import { websites } from "./tenancy";

export const topics = pgTable(
  "topics",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    name: text().notNull(),
    description: text(),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("topics_ws_name_idx").on(t.websiteId, t.name)],
);

export const promptSchedules = pgTable("prompt_schedules", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  name: text().notNull(),
  kind: scheduleKindEnum().notNull().default("custom"),
  /** cron-like spec, e.g. "daily" | "every 6 hours" */
  cadence: text().notNull().default("daily"),
  createdAt: ts().notNull(),
  archivedAt: timestamp({ withTimezone: true }),
});

export const prompts = pgTable(
  "prompts",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    topicId: uuid().references(() => topics.id),
    personaId: uuid().references(() => personas.id),
    locationId: uuid().references(() => locations.id),
    text: text().notNull(),
    type: promptTypeEnum().notNull().default("non_branded"),
    status: promptStatusEnum().notNull().default("active"),
    scheduleId: uuid().references(() => promptSchedules.id),
    volumeEstimate: integer().default(0),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("prompts_ws_status_idx").on(t.websiteId, t.status),
    uniqueIndex("prompts_ws_text_live_idx").on(t.websiteId, sql`lower(${t.text})`).where(sql`${t.deletedAt} is null`),
  ],
);

export const promptTags = pgTable(
  "prompt_tags",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    name: text().notNull(),
    color: text().default("#4f39f6"),
  },
  (t) => [uniqueIndex("prompt_tags_ws_name_idx").on(t.websiteId, t.name)],
);

export const promptTagLinks = pgTable(
  "prompt_tag_links",
  {
    promptId: uuid()
      .notNull()
      .references(() => prompts.id),
    tagId: uuid()
      .notNull()
      .references(() => promptTags.id),
  },
  (t) => [primaryKey({ columns: [t.promptId, t.tagId] })],
);

export const personas = pgTable(
  "personas",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    name: text().notNull(),
    description: text(),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("personas_ws_name_live_idx").on(t.websiteId, sql`lower(${t.name})`).where(sql`${t.deletedAt} is null`)],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    name: text().notNull(),
    country: text().notNull().default("US"),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("locations_ws_name_live_idx").on(t.websiteId, sql`lower(${t.name})`).where(sql`${t.deletedAt} is null`)],
);

export const competitors = pgTable(
  "competitors",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    domain: text().notNull(),
    name: text().notNull(),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("competitors_ws_domain_live_idx").on(t.websiteId, t.domain).where(sql`${t.deletedAt} is null`)],
);
