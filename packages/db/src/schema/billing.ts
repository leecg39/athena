/* Billing: credits */
import { pgTable, uuid, text, timestamp, integer, index, primaryKey } from "drizzle-orm/pg-core";
import { planEnum, subStatusEnum, ts } from "./enums";
import { groups, organizations, users, websites } from "./tenancy";
import { runs } from "./responses";

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
