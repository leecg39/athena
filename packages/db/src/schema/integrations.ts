/* Third-party integrations (Search Console, CMS, Slack …) per website */
import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ts } from "./enums";
import { users, websites } from "./tenancy";

export const integrations = pgTable(
  "integrations",
  {
    id: uuid().primaryKey().defaultRandom(),
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    /** gsc | ga4 | wordpress | slack | … */
    provider: text().notNull(),
    /** connected | error | disconnected */
    status: text().notNull().default("connected"),
    /** human-readable account / property, e.g. "sc-domain:example.com" */
    externalAccount: text(),
    config: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** AES-256-GCM encrypted JSON credentials (never returned to clients) */
    secret: text(),
    connectedBy: uuid().references(() => users.id),
    connectedAt: ts().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integrations_ws_provider_idx").on(t.websiteId, t.provider)],
);
