/* Action: outreach / insights / shopping / ads / site health */
import { pgTable, uuid, text, timestamp, boolean, integer, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { insightStatusEnum, outreachStatusEnum, ts } from "./enums";
import { websites } from "./tenancy";
import { prompts } from "./tracking";

export const outreachOpportunities = pgTable(
  "outreach_opportunities",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    url: text().notNull(),
    domain: text().notNull(),
    status: outreachStatusEnum().notNull().default("new"),
    citationPct: numeric({ precision: 5, scale: 2 }).notNull().default("0"),
    estimatedImpressions: integer().notNull().default(0),
    citations: integer().notNull().default(0),
    authorName: text(),
    authorEmail: text(),
    emailDraft: text(),
    notes: text(),
    createdAt: ts().notNull(),
  },
  (t) => [index("outreach_ws_status_idx").on(t.websiteId, t.status, t.citations)],
);

export const insights = pgTable(
  "insights",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    title: text().notNull(),
    body: text().notNull(),
    kind: text().notNull().default("opportunity"), // opportunity | gap | competitor_move | integrity
    status: insightStatusEnum().notNull().default("active"),
    /** suggested action payload (e.g. create content item) */
    action: jsonb().$type<Record<string, unknown>>().default({}),
    createdAt: ts().notNull(),
  },
  (t) => [index("insights_website_status_idx").on(t.websiteId, t.status, t.createdAt)],
);

export const shoppingProducts = pgTable(
  "shopping_products",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    title: text().notNull(),
    retailer: text(),
    price: numeric({ precision: 10, scale: 2 }),
    appearances: integer().notNull().default(0),
    avgPosition: numeric({ precision: 5, scale: 2 }).default("0"),
    isOwn: boolean().notNull().default(true),
    lastSeenAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("shopping_ws_own_idx").on(t.websiteId, t.isOwn, t.appearances)],
);

export const adsImpressions = pgTable(
  "ads_impressions",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    promptId: uuid().references(() => prompts.id, { onDelete: "set null" }),
    /** chatgpt | ai_mode | ai_overview */
    surface: text().notNull(),
    advertiser: text().notNull(),
    adText: text(),
    seenAt: ts().notNull(),
  },
  (t) => [index("ads_ws_surface_seen_idx").on(t.websiteId, t.surface, t.seenAt)],
);

export interface SiteHealthPageMeta {
  property?: string;
  robotsBots?: {
    bot: string;
    owner: string;
    purpose: string;
    status: "allowed" | "blocked";
    rule: string;
  }[];
  llmsTxtPresent?: boolean;
  schemaMarkup?: string[];
  stagingStatusCode?: number;
  stagingAiAccessible?: boolean;
  stagingDiffSummary?: string;
  optimizationStatus?: "healthy" | "needs_edit" | "staged" | "verified_live";
  optimizationRecommendation?: string;
  verifiedAt?: string | null;
  verificationHash?: string | null;
}

export const siteHealthPages = pgTable(
  "site_health_pages",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    url: text().notNull(),
    title: text(),
    statusCode: integer(),
    aiAccessible: boolean().default(true),
    inSitemap: boolean().default(true),
    keywords: jsonb().$type<{ keyword: string; position: number; volume?: number; change?: number }[]>().default([]),
    meta: jsonb().$type<SiteHealthPageMeta>().default({}),
    lastCheckedAt: timestamp({ withTimezone: true }),
    createdAt: ts().notNull(),
  },
  (t) => [index("site_health_ws_idx").on(t.websiteId, t.aiAccessible, t.inSitemap)],
);
