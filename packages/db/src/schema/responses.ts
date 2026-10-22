/* Response collection */
import { pgTable, uuid, text, timestamp, boolean, integer, numeric, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { runStateEnum, sentimentEnum, sourceTypeEnum, ts } from "./enums";
import { users, websites } from "./tenancy";
import { competitors, promptSchedules, prompts } from "./tracking";

/** One scheduled or ad-hoc collection run over a website's prompts. */
export const runs = pgTable(
  "runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    scheduleId: uuid().references(() => promptSchedules.id),
    /** external workflow id (Inngest) for polling */
    workflowId: text(),
    state: runStateEnum().notNull().default("queued"),
    totalResponses: integer().notNull().default(0),
    completedResponses: integer().notNull().default(0),
    creditsReserved: integer().notNull().default(0),
    /** credits returned to the balance for items that failed */
    creditsRefunded: integer().notNull().default(0),
    failedResponses: integer().notNull().default(0),
    /** manual | schedule | api */
    trigger: text().notNull().default("manual"),
    requestedBy: uuid().references(() => users.id),
    models: jsonb().$type<string[]>().notNull().default([]),
    error: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: ts().notNull(),
  },
  (t) => [index("runs_website_idx").on(t.websiteId, t.createdAt)],
);

export const responses = pgTable(
  "responses",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid().references(() => runs.id),
    promptId: uuid()
      .notNull()
      .references(() => prompts.id),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    /** provider label: chatgpt | perplexity | gemini | claude | copilot | grok | deepseek | ai_overview | ai_mode | meta_ai | mistral */
    model: text().notNull(),
    rawText: text().notNull(),
    /** 1-based rank of the brand within the answer, null if not mentioned */
    position: integer(),
    sentiment: sentimentEnum().default("unknown"),
    mentioned: boolean().notNull().default(false),
    cited: boolean().notNull().default(false),
    /** detected shopping carousel/product card (AI shopping surfaces) */
    shoppingCard: jsonb().$type<{
      product?: string;
      price?: number;
      retailer?: string;
      rank?: number;
    } | null>(),
    tokensIn: integer().default(0),
    tokensOut: integer().default(0),
    /** concrete provider/model that answered, e.g. "anthropic:claude-opus-5-5" */
    provider: text(),
    /** produced by the dev-only simulated provider — never real AI output */
    simulated: boolean().notNull().default(false),
    ranAt: ts().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [
    index("responses_prompt_time_idx").on(t.promptId, t.ranAt),
    index("responses_ws_time_idx").on(t.websiteId, t.ranAt),
  ],
);

export const responseMentions = pgTable(
  "response_mentions",
  {
    id: uuid().primaryKey().defaultRandom(),
    responseId: uuid()
      .notNull()
      .references(() => responses.id),
    /** null = own brand, else competitor id */
    competitorId: uuid().references(() => competitors.id),
    name: text().notNull(),
    sentiment: sentimentEnum().default("unknown"),
    position: integer(),
  },
  (t) => [index("mentions_resp_idx").on(t.responseId)],
);

export const responseCitations = pgTable(
  "response_citations",
  {
    id: uuid().primaryKey().defaultRandom(),
    responseId: uuid()
      .notNull()
      .references(() => responses.id),
    url: text().notNull(),
    domain: text().notNull(),
    /** registrable domain (public-suffix aware), e.g. blog.canva.com → canva.com */
    rootDomain: text(),
    /** URL without tracking params/fragment/trailing slash, for page-level grouping */
    normalizedUrl: text(),
    /** order of the citation within the answer */
    rank: integer().notNull().default(0),
    isBrand: boolean().notNull().default(false),
  },
  (t) => [
    index("citations_resp_idx").on(t.responseId),
    index("citations_domain_idx").on(t.domain),
    index("citations_root_idx").on(t.rootDomain),
    index("citations_norm_url_idx").on(t.normalizedUrl),
  ],
);

/** Direction-neutral brand-perception attributes ("easy to use", "expensive"...). */
export const attributes = pgTable("attributes", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  name: text().notNull(),
  createdAt: ts().notNull(),
});

export const attributeObservations = pgTable(
  "attribute_observations",
  {
    id: uuid().primaryKey().defaultRandom(),
    attributeId: uuid()
      .notNull()
      .references(() => attributes.id),
    responseId: uuid()
      .notNull()
      .references(() => responses.id),
    /** null = own brand */
    competitorId: uuid().references(() => competitors.id),
    textSpan: text().notNull(),
    /** -1.0 .. 1.0 */
    score: numeric({ precision: 3, scale: 2 }).notNull(),
    positive: boolean().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [index("attr_obs_attr_idx").on(t.attributeId)],
);

/** Aggregated per-domain source intelligence. */
export const sources = pgTable(
  "sources",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    domain: text().notNull(),
    type: sourceTypeEnum().notNull().default("t"),
    citationCount: integer().notNull().default(0),
    mentionInfluenced: integer().notNull().default(0),
    responsesInfluenced: integer().notNull().default(0),
    competitorMentionPct: numeric({ precision: 5, scale: 2 }).notNull().default("0"),
    /** daily series cache: [{date, citation_rate}] */
    spark: jsonb()
      .$type<{ date: string; citationRate: number }[]>()
      .default([]),
    updatedAt: ts().notNull(),
  },
  (t) => [uniqueIndex("sources_ws_domain_idx").on(t.websiteId, t.domain)],
);

/** One unit of work in a run: a prompt asked to one AI model (idempotent, resumable). */
export const runItems = pgTable(
  "run_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => runs.id),
    promptId: uuid()
      .notNull()
      .references(() => prompts.id),
    model: text().notNull(),
    /** pending | running | succeeded | failed */
    status: text().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    responseId: uuid().references(() => responses.id),
    error: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_items_unique_idx").on(t.runId, t.promptId, t.model), index("run_items_run_status_idx").on(t.runId, t.status)],
);

/** Per-website source-type overrides: a host ("reddit.com") or a URL prefix ("reddit.com/user/brand"). */
export const sourceOverrides = pgTable(
  "source_overrides",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    pattern: text().notNull(),
    /** owned | competitor | partner | third_party */
    type: text().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [uniqueIndex("source_overrides_ws_pattern_idx").on(t.websiteId, t.pattern)],
);
