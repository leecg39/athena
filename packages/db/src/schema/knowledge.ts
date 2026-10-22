/* Knowledge base & Oracle */
import { pgTable, uuid, text, numeric, jsonb, index, primaryKey } from "drizzle-orm/pg-core";
import { deletedAt, factStatusEnum, oracleFindingEnum, oracleStatusEnum, ts } from "./enums";
import { websites } from "./tenancy";
import { responses } from "./responses";

export const kbPillars = pgTable("kb_pillars", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  name: text().notNull(),
  document: text(),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

export const kbFacts = pgTable(
  "kb_facts",
  {
    id: uuid().primaryKey().defaultRandom(),
    pillarId: uuid()
      .notNull()
      .references(() => kbPillars.id),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
  claim: text().notNull(),
    sourceUrl: text(),
    status: factStatusEnum().notNull().default("pending_review"),
    confidence: numeric({ precision: 3, scale: 2 }).default("0.90"),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [index("kb_facts_ws_status_idx").on(t.websiteId, t.status)],
);

export const oracleFindings = pgTable("oracle_findings", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  responseId: uuid().references(() => responses.id),
  factId: uuid().references(() => kbFacts.id),
  type: oracleFindingEnum().notNull(),
  status: oracleStatusEnum().notNull().default("open"),
  claim: text().notNull(),
  evidence: text(),
  models: jsonb().$type<string[]>().default([]),
  createdAt: ts().notNull(),
});
