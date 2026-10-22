/* Pitches / reports / saved views */
import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { deletedAt, ts } from "./enums";
import { groups, organizations, websites } from "./tenancy";

export const pitches = pgTable(
  "pitches",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    websiteUrl: text().notNull(),
    brandName: text().notNull(),
    shareId: text().notNull().unique(),
    kind: text().notNull().default("visibility"), // visibility | content
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [index("pitches_org_idx").on(t.organizationId, t.createdAt)],
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid().references(() => websites.id),
    groupId: uuid().references(() => groups.id),
    name: text().notNull(),
    filters: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts().notNull(),
  },
  (t) => [index("saved_views_group_idx").on(t.groupId, t.createdAt)],
);

export const scheduledReports = pgTable(
  "scheduled_reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    name: text().notNull(),
    shareId: text().notNull().unique(),
    /** ai_search | content_proposal */
    reportType: text().notNull().default("ai_search"),
    /** chart keys to include */
    charts: jsonb().$type<string[]>().notNull().default([]),
    recipients: jsonb().$type<string[]>().notNull().default([]),
    cadence: text().notNull().default("weekly"),
    slackChannel: text(),
    lastSentAt: timestamp({ withTimezone: true }),
    createdAt: ts().notNull(),
  },
  (t) => [index("scheduled_reports_ws_idx").on(t.websiteId, t.createdAt)],
);
