import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const orgRoleEnum = pgEnum("org_role", [
  "owner",
  "admin",
  "billing",
  "member",
  "custom",
]);
export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "member",
  "custom",
]);
export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export const promptStatusEnum = pgEnum("prompt_status", [
  "active",
  "paused",
  "deleted",
]);
export const promptTypeEnum = pgEnum("prompt_type", ["branded", "non_branded"]);
export const runStateEnum = pgEnum("run_state", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const sentimentEnum = pgEnum("sentiment", [
  "positive",
  "neutral",
  "negative",
  "mixed",
  "unknown",
]);
export const sourceTypeEnum = pgEnum("source_type", [
  "c", // community
  "t", // third-party
  "o", // owned
  "p", // partner/press
]);
export const factStatusEnum = pgEnum("fact_status", [
  "pending_review",
  "confirmed",
  "rejected",
]);
export const contentStatusEnum = pgEnum("content_status", [
  "idea",
  "brief",
  "draft",
  "review",
  "approved",
  "published",
]);
export const insightStatusEnum = pgEnum("insight_status", [
  "active",
  "resolved",
  "discarded",
]);
export const oracleFindingEnum = pgEnum("oracle_finding_type", [
  "confirmed_inaccuracy",
  "kb_inconsistency",
  "model_disagreement",
]);
export const oracleStatusEnum = pgEnum("oracle_status", [
  "open",
  "resolving",
  "resolved",
  "dismissed",
]);
export const outreachStatusEnum = pgEnum("outreach_status", [
  "new",
  "todo",
  "done",
]);
export const planEnum = pgEnum("plan_tier", ["free", "starter", "enterprise"]);
export const subStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
]);
export const scheduleKindEnum = pgEnum("schedule_kind", [
  "default",
  "custom",
  "archived",
]);
export const healthStatusEnum = pgEnum("health_status", [
  "pass",
  "warn",
  "fail",
  "pending",
]);

const ts = () => timestamp({ withTimezone: true, defaultNow: () => sql`now()` });
const deletedAt = () => timestamp({ withTimezone: true });

/* ------------------------------------------------------------------ */
/* Identity & tenancy                                                  */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text(),
  image: text(),
  createdAt: ts().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  plan: planEnum().notNull().default("free"),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

/** Custom roles (per-org permission sets). */
export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    /** jsonb array of permission strings, e.g. ["prompts:read","billing:write"] */
    permissions: jsonb().$type<string[]>().notNull().default([]),
    createdAt: ts().notNull(),
  },
  (t) => [uniqueIndex("custom_roles_org_name_idx").on(t.organizationId, t.name)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: orgRoleEnum().notNull().default("member"),
    customRoleId: uuid().references(() => customRoles.id),
    createdAt: ts().notNull(),
  },
  (t) => [uniqueIndex("org_members_org_user_idx").on(t.organizationId, t.userId)],
);

/** Brand groups (agencies / multi-brand portfolios). */
export const groups = pgTable("groups", {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  name: text().notNull(),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid()
      .notNull()
      .references(() => groups.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum().notNull().default("member"),
    createdAt: ts().notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/** A tracked brand/website — the workspace unit. */
export const websites = pgTable(
  "websites",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    groupId: uuid().references(() => groups.id),
    domain: text().notNull(),
    name: text().notNull(),
    brandVoice: text(),
    brandTraits: jsonb().$type<string[]>().default([]),
    /** canonical brand profile for tracking + generation */
    profile: jsonb()
      .$type<{
        description?: string;
        products?: string[];
        audiences?: string[];
        differentiators?: string[];
      }>()
      .default({}),
    llmsTxtEnabled: boolean().notNull().default(false),
    timezone: text().notNull().default("UTC"),
    country: text().notNull().default("US"),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [index("websites_org_idx").on(t.organizationId)],
);

export const websiteMembers = pgTable(
  "website_members",
  {
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum().notNull().default("member"),
    customRoleId: uuid().references(() => customRoles.id),
    createdAt: ts().notNull(),
  },
  (t) => [primaryKey({ columns: [t.websiteId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  websiteId: uuid().references(() => websites.id),
  email: text().notNull(),
  role: orgRoleEnum().notNull().default("member"),
  status: inviteStatusEnum().notNull().default("pending"),
  inviterId: uuid().references(() => users.id),
  createdAt: ts().notNull(),
  expiresAt: timestamp({ withTimezone: true }),
});

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    websiteId: uuid().references(() => websites.id),
    userId: uuid().references(() => users.id),
    entityType: text().notNull(), // prompt | topic | tag | website | member ...
    entityId: uuid(),
    change: text().notNull(), // created | updated | deleted | restored | paused | unpaused
    before: jsonb(),
    after: jsonb(),
    createdAt: ts().notNull(),
  },
  (t) => [index("activity_org_time_idx").on(t.organizationId, t.createdAt)],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  name: text().notNull(),
  hashedKey: text().notNull().unique(),
  prefix: text().notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: ts().notNull(),
});

/* ------------------------------------------------------------------ */
/* Tracking: topics / prompts / personas / locations / competitors     */
/* ------------------------------------------------------------------ */

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
    personaId: uuid(),
    text: text().notNull(),
    type: promptTypeEnum().notNull().default("non_branded"),
    status: promptStatusEnum().notNull().default("active"),
    scheduleId: uuid().references(() => promptSchedules.id),
    volumeEstimate: integer().default(0),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [index("prompts_ws_status_idx").on(t.websiteId, t.status)],
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

export const personas = pgTable("personas", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  name: text().notNull(),
  description: text(),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

export const locations = pgTable("locations", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  name: text().notNull(),
  country: text().notNull().default("US"),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

export const competitors = pgTable("competitors", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  domain: text().notNull(),
  name: text().notNull(),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

/* ------------------------------------------------------------------ */
/* Response collection                                                 */
/* ------------------------------------------------------------------ */

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
    /** order of the citation within the answer */
    rank: integer().notNull().default(0),
    isBrand: boolean().notNull().default(false),
  },
  (t) => [index("citations_resp_idx").on(t.responseId), index("citations_domain_idx").on(t.domain)],
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

/* ------------------------------------------------------------------ */
/* Knowledge base & Oracle                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Content hub & publishing                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Action: outreach / insights / shopping / ads / site health           */
/* ------------------------------------------------------------------ */

export const outreachOpportunities = pgTable("outreach_opportunities", {
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
});

export const insights = pgTable("insights", {
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
});

export const shoppingProducts = pgTable("shopping_products", {
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
});

export const adsImpressions = pgTable("ads_impressions", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  promptId: uuid().references(() => prompts.id),
  /** chatgpt | ai_mode | ai_overview */
  surface: text().notNull(),
  advertiser: text().notNull(),
  adText: text(),
  seenAt: ts().notNull(),
});

export const siteHealthPages = pgTable("site_health_pages", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  url: text().notNull(),
  title: text(),
  statusCode: integer(),
  aiAccessible: boolean().default(true),
  inSitemap: boolean().default(true),
  keywords: jsonb().$type<{ keyword: string; position: number }[]>().default([]),
  lastCheckedAt: timestamp({ withTimezone: true }),
  createdAt: ts().notNull(),
});

/* ------------------------------------------------------------------ */
/* Pitches / reports / saved views                                     */
/* ------------------------------------------------------------------ */

export const pitches = pgTable("pitches", {
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
});

export const savedViews = pgTable("saved_views", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid().references(() => websites.id),
  groupId: uuid().references(() => groups.id),
  name: text().notNull(),
  filters: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts().notNull(),
});

export const scheduledReports = pgTable("scheduled_reports", {
  id: uuid().primaryKey().defaultRandom(),
  websiteId: uuid()
    .notNull()
    .references(() => websites.id),
  name: text().notNull(),
  shareId: text().notNull().unique(),
  /** chart keys to include */
  charts: jsonb().$type<string[]>().notNull().default([]),
  recipients: jsonb().$type<string[]>().notNull().default([]),
  cadence: text().notNull().default("weekly"),
  slackChannel: text(),
  lastSentAt: timestamp({ withTimezone: true }),
  createdAt: ts().notNull(),
});

/* ------------------------------------------------------------------ */
/* Billing: credits                                                    */
/* ------------------------------------------------------------------ */

export const creditBalances = pgTable(
  "credit_balances",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    websiteId: uuid().references(() => websites.id),
    groupId: uuid().references(() => groups.id),
    balance: integer().notNull().default(0),
    updatedAt: ts().notNull(),
  },
  (t) => [index("credit_balances_org_idx").on(t.organizationId)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    websiteId: uuid().references(() => websites.id),
    groupId: uuid().references(() => groups.id),
    /** grant | consume | refund | adjustment */
    kind: text().notNull(),
    amount: integer().notNull(), // negative for consume
    reason: text(),
    runId: uuid().references(() => runs.id),
    createdAt: ts().notNull(),
  },
  (t) => [index("credit_ledger_org_time_idx").on(t.organizationId, t.createdAt)],
);

export const subscriptions = pgTable("subscriptions", {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  websiteId: uuid().references(() => websites.id),
  plan: planEnum().notNull().default("free"),
  status: subStatusEnum().notNull().default("active"),
  stripeSubscriptionId: text(),
  stripeCustomerId: text(),
  monthlyCredits: integer().notNull().default(300),
  currentPeriodEnd: timestamp({ withTimezone: true }),
  createdAt: ts().notNull(),
});

export const invoices = pgTable("invoices", {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  stripeInvoiceId: text(),
  amountCents: integer().notNull().default(0),
  currency: text().notNull().default("usd"),
  status: text().notNull().default("paid"),
  pdfUrl: text(),
  issuedAt: timestamp({ withTimezone: true }),
});

/** Persisted auth sessions/verification tokens for Auth.js database strategy. */
export const authAccounts = pgTable("auth_accounts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  provider: text().notNull(),
  providerAccountId: text().notNull(),
  createdAt: ts().notNull(),
});

export const authSessions = pgTable("auth_sessions", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  sessionToken: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text().notNull(),
  token: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});
