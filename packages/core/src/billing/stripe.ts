/**
 * Stripe webhook processing over normalized, signature-verified events.
 *  - plan / add-on subscriptions: the checkout links the Stripe ids; every
 *    paid invoice (first and renewals) records the real amount and grants the
 *    period's credits once (the invoice id deduplicates retries);
 *  - credit packs: granted once per paid checkout session;
 *  - cancellations downgrade to Free / remove the add-on.
 */
import { and, eq, or } from "drizzle-orm";
import { type Db, organizations, subscriptions } from "@athena/db";
import type { PlanTier } from "../index";
import { BILLING_ADDON_CATALOG, BILLING_PLAN_CATALOG, CREDIT_PACK_CATALOG, type BillingAddonId, type BillingInterval, type CreditPackId } from "./catalog";
import { grantOrgCredits, lockOrg, recordInvoice, setAddon, setPlan } from "./apply";

type Ref = { organizationId: string | null; subscriptionId: string | null; customerId: string | null };

export type StripeBillingEvent =
  | (Ref & { type: "plan_linked"; plan: PlanTier; billingInterval: BillingInterval })
  | (Ref & { type: "addon_linked"; addonId: BillingAddonId })
  | (Ref & { type: "invoice_paid"; invoiceId: string; amountCents: number; currency: string; firstOrRenewal: boolean; plan: PlanTier | null; billingInterval: BillingInterval | null; addonId: BillingAddonId | null; periodEnd: Date | null })
  | (Ref & { type: "pack_paid"; sessionId: string; packId: CreditPackId; amountCents: number; currency: string })
  | (Ref & { type: "plan_updated"; plan: PlanTier; billingInterval: BillingInterval | null; status: "active" | "past_due" | "canceled" })
  | (Ref & { type: "subscription_canceled"; addonId: BillingAddonId | null });

export type StripeOutcome = { processed: boolean; reason?: string };

/** The organization an event belongs to: our own checkout metadata, else the stored Stripe ids. */
async function resolveOrg(db: Db, ref: Ref): Promise<string | null> {
  if (ref.organizationId) {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, ref.organizationId));
    if (org) return org.id;
  }
  const ids = [ref.subscriptionId ? eq(subscriptions.stripeSubscriptionId, ref.subscriptionId) : null, ref.customerId ? eq(subscriptions.stripeCustomerId, ref.customerId) : null].filter((c) => c !== null);
  if (!ids.length) return null;
  const [row] = await db.select({ organizationId: subscriptions.organizationId }).from(subscriptions).where(or(...ids));
  return row?.organizationId ?? null;
}

async function invoicePaid(tx: Db, organizationId: string, e: Extract<StripeBillingEvent, { type: "invoice_paid" }>): Promise<StripeOutcome> {
  const addon = e.addonId ? BILLING_ADDON_CATALOG.find((a) => a.id === e.addonId) : null;
  const plan = e.plan ? BILLING_PLAN_CATALOG[e.plan] : null;
  const label = addon ? addon.label : plan ? `${plan.label} plan` : "Subscription";
  const recorded = await recordInvoice(tx, organizationId, { kind: "stripe", invoiceId: e.invoiceId, amountCents: e.amountCents, currency: e.currency }, `${label} (${e.billingInterval ?? "monthly"})`);
  if (!recorded) return { processed: false, reason: "duplicate invoice" };
  if (e.plan) await setPlan(tx, { organizationId, plan: e.plan, billingInterval: e.billingInterval ?? undefined, stripeSubscriptionId: e.subscriptionId, stripeCustomerId: e.customerId, currentPeriodEnd: e.periodEnd });
  // proration invoices for mid-period changes record the payment without a new allowance
  if (e.firstOrRenewal && addon) await grantOrgCredits(tx, organizationId, addon.bonusCredits, `${addon.label}: credits for the paid month`);
  if (e.firstOrRenewal && plan && plan.monthlyCredits > 0) await grantOrgCredits(tx, organizationId, plan.monthlyCredits, `${plan.label} plan: credits for the paid period`);
  return { processed: true };
}

async function packPaid(tx: Db, organizationId: string, e: Extract<StripeBillingEvent, { type: "pack_paid" }>): Promise<StripeOutcome> {
  const pack = CREDIT_PACK_CATALOG.find((p) => p.id === e.packId)!;
  const recorded = await recordInvoice(tx, organizationId, { kind: "stripe", invoiceId: `cs_${e.sessionId}`, amountCents: e.amountCents, currency: e.currency }, `${pack.label} credit pack`);
  if (!recorded) return { processed: false, reason: "duplicate checkout session" };
  await grantOrgCredits(tx, organizationId, pack.credits, `${pack.label} credit pack (paid)`);
  return { processed: true };
}

export async function processStripeWebhookEvent(db: Db, e: StripeBillingEvent): Promise<StripeOutcome> {
  const organizationId = await resolveOrg(db, e);
  if (!organizationId) return { processed: false, reason: "no organization for this Stripe object" };
  return db.transaction(async (tx) => {
    await lockOrg(tx, organizationId);
    switch (e.type) {
      case "plan_linked":
        await setPlan(tx, { organizationId, plan: e.plan, billingInterval: e.billingInterval, stripeSubscriptionId: e.subscriptionId, stripeCustomerId: e.customerId });
        return { processed: true };
      case "addon_linked":
        await setAddon(tx, organizationId, e.addonId, true);
        return { processed: true };
      case "invoice_paid":
        return invoicePaid(tx, organizationId, e);
      case "pack_paid":
        return packPaid(tx, organizationId, e);
      case "plan_updated":
        await setPlan(tx, { organizationId, plan: e.status === "canceled" ? "free" : e.plan, billingInterval: e.billingInterval ?? undefined, status: e.status });
        return { processed: true };
      case "subscription_canceled": {
        if (e.addonId) {
          await setAddon(tx, organizationId, e.addonId, false);
          return { processed: true };
        }
        const [sub] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(and(eq(subscriptions.organizationId, organizationId), e.subscriptionId ? eq(subscriptions.stripeSubscriptionId, e.subscriptionId) : eq(subscriptions.organizationId, organizationId)));
        if (!sub) return { processed: false, reason: "not the organization's plan subscription" };
        await setPlan(tx, { organizationId, plan: "free", status: "canceled", stripeSubscriptionId: null });
        return { processed: true };
      }
    }
  });
}
