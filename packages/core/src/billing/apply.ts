/**
 * Billing state changes. They run only from a verified Stripe webhook
 * (source "stripe": the real invoice and amount) or the opt-in development
 * test mode (source "test": recorded as not charged). Nothing here takes a
 * payment, and no Stripe identifiers are invented.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { type Db, creditBalances, creditLedger, invoices, organizations, subscriptions } from "@athena/db";
import { NotFoundError } from "../org/errors";
import type { PlanTier } from "../index";
import { BILLING_PLAN_CATALOG, type BillingAddonId, type BillingInterval } from "./catalog";

export type BillingSource =
  | { kind: "stripe"; invoiceId: string; amountCents: number; currency: string }
  | { kind: "test" };

export const lockOrg = (tx: Db, organizationId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + organizationId}))`);

/** The organization's subscription row (created as Free with no Stripe ids when missing). */
export async function subscriptionRow(tx: Db, organizationId: string) {
  const [existing] = await tx.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  if (existing) return existing;
  const [org] = await tx.select({ plan: organizations.plan }).from(organizations).where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)));
  if (!org) throw new NotFoundError("Organization not found");
  const [created] = await tx.insert(subscriptions).values({ organizationId, plan: org.plan, status: "active", billingInterval: "monthly", addons: [], monthlyCredits: BILLING_PLAN_CATALOG[org.plan].monthlyCredits }).returning();
  return created!;
}

export async function grantOrgCredits(tx: Db, organizationId: string, amount: number, reason: string): Promise<number> {
  const orgPool = and(eq(creditBalances.organizationId, organizationId), isNull(creditBalances.websiteId), isNull(creditBalances.groupId));
  const [updated] = await tx.update(creditBalances).set({ balance: sql`${creditBalances.balance} + ${amount}`, updatedAt: new Date() }).where(orgPool).returning({ balance: creditBalances.balance });
  const balance = updated ? updated.balance : (await tx.insert(creditBalances).values({ organizationId, balance: amount }).returning({ balance: creditBalances.balance }))[0]!.balance;
  await tx.insert(creditLedger).values({ organizationId, kind: "grant", amount, reason });
  return balance;
}

/**
 * Records the invoice for a change. Stripe invoices are stored once (the
 * unique invoice id makes webhook retries no-ops: returns null). Test-mode
 * entries are stored with status "test" and no amount.
 */
export async function recordInvoice(tx: Db, organizationId: string, source: BillingSource, description: string): Promise<string | null> {
  const values =
    source.kind === "stripe"
      ? { organizationId, stripeInvoiceId: source.invoiceId, description, amountCents: source.amountCents, currency: source.currency, status: "paid", issuedAt: new Date() }
      : { organizationId, stripeInvoiceId: null, description: `${description} (test mode — not charged)`, amountCents: 0, currency: "usd", status: "test", issuedAt: new Date() };
  const [row] = await tx.insert(invoices).values(values).onConflictDoNothing({ target: invoices.stripeInvoiceId }).returning({ id: invoices.id });
  if (!row) return null;
  await tx.update(invoices).set({ pdfUrl: `/api/billing/invoices/${row.id}/pdf` }).where(eq(invoices.id, row.id));
  return row.id;
}

/** Sets the plan (and Stripe ids when known); credits come with paid periods, not with plan changes. */
export async function setPlan(
  tx: Db,
  input: { organizationId: string; plan: PlanTier; billingInterval?: BillingInterval; status?: "active" | "canceled" | "past_due"; stripeSubscriptionId?: string | null; stripeCustomerId?: string | null; currentPeriodEnd?: Date | null },
) {
  const sub = await subscriptionRow(tx, input.organizationId);
  await tx.update(organizations).set({ plan: input.plan }).where(eq(organizations.id, input.organizationId));
  await tx
    .update(subscriptions)
    .set({
      plan: input.plan,
      status: input.status ?? "active",
      billingInterval: input.billingInterval ?? sub.billingInterval,
      monthlyCredits: BILLING_PLAN_CATALOG[input.plan].monthlyCredits,
      ...(input.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: input.stripeSubscriptionId } : {}),
      ...(input.stripeCustomerId !== undefined ? { stripeCustomerId: input.stripeCustomerId } : {}),
      ...(input.currentPeriodEnd !== undefined ? { currentPeriodEnd: input.currentPeriodEnd } : {}),
    })
    .where(eq(subscriptions.id, sub.id));
  return sub;
}

export async function setAddon(tx: Db, organizationId: string, addonId: BillingAddonId, enabled: boolean): Promise<BillingAddonId[]> {
  const sub = await subscriptionRow(tx, organizationId);
  const current = (Array.isArray(sub.addons) ? sub.addons : []).filter((a) => a !== addonId) as BillingAddonId[];
  const next = enabled ? [...current, addonId] : current;
  await tx.update(subscriptions).set({ addons: next }).where(eq(subscriptions.id, sub.id));
  return next;
}
