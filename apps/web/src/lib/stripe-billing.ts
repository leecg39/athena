import "server-only";
import Stripe from "stripe";
import { isAddonId, isPackId, isPlanTier, testBillingEnabled, type BillingAddonId, type BillingInterval, type CreditPackId, type StripeBillingEvent } from "@athena/core/billing";
import type { PlanTier } from "@athena/core";

export type BillingMode = "stripe" | "test" | "off";
type Env = Record<string, string | undefined>;
export type CheckoutItem = { kind: "plan"; plan: Exclude<PlanTier, "free">; interval: BillingInterval } | { kind: "pack"; packId: CreditPackId } | { kind: "addon"; addonId: BillingAddonId };

export function billingMode(env: Env = process.env): BillingMode {
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) return "stripe";
  return testBillingEnabled(env) ? "test" : "off";
}

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

/** Stripe price ids, one environment variable per sellable item. */
const PRICE_ENV: Record<string, string> = {
  "plan:starter:monthly": "STRIPE_PRICE_STARTER_MONTHLY",
  "plan:starter:annual": "STRIPE_PRICE_STARTER_ANNUAL",
  "plan:enterprise:monthly": "STRIPE_PRICE_ENTERPRISE_MONTHLY",
  "plan:enterprise:annual": "STRIPE_PRICE_ENTERPRISE_ANNUAL",
  "pack:pack_1k": "STRIPE_PRICE_PACK_1K",
  "pack:pack_5k": "STRIPE_PRICE_PACK_5K",
  "pack:pack_15k": "STRIPE_PRICE_PACK_15K",
  "addon:api_mcp_addon": "STRIPE_PRICE_ADDON_API_MCP",
  "addon:pitch_pro_addon": "STRIPE_PRICE_ADDON_PITCH_PRO",
};

const itemKey = (item: CheckoutItem) => (item.kind === "plan" ? `plan:${item.plan}:${item.interval}` : item.kind === "pack" ? `pack:${item.packId}` : `addon:${item.addonId}`);

export function priceFor(item: CheckoutItem, env: Env = process.env): { envName: string; priceId: string | null } {
  const envName = PRICE_ENV[itemKey(item)]!;
  return { envName, priceId: env[envName] || null };
}

/** What a Stripe price sells (to follow plan changes made in the Customer Portal). */
export function itemForPrice(priceId: string | null | undefined, env: Env = process.env): CheckoutItem | null {
  if (!priceId) return null;
  const key = Object.entries(PRICE_ENV).find(([, name]) => env[name] === priceId)?.[0];
  if (!key) return null;
  const [kind, a, b] = key.split(":");
  if (kind === "plan" && (a === "starter" || a === "enterprise")) return { kind: "plan", plan: a, interval: b === "annual" ? "annual" : "monthly" };
  if (kind === "pack" && isPackId(a)) return { kind: "pack", packId: a };
  if (kind === "addon" && isAddonId(a)) return { kind: "addon", addonId: a };
  return null;
}

export async function createCheckoutSession(input: { organizationId: string; customerId: string | null; email: string | null; item: CheckoutItem; origin: string }): Promise<string> {
  const { envName, priceId } = priceFor(input.item);
  if (!priceId) throw new Error(`${envName} is not configured`);
  const metadata: Record<string, string> = { organizationId: input.organizationId, kind: input.item.kind, ...(input.item.kind === "plan" ? { plan: input.item.plan, billingInterval: input.item.interval } : input.item.kind === "pack" ? { packId: input.item.packId } : { addonId: input.item.addonId }) };
  const subscription = input.item.kind !== "pack";
  const session = await stripeClient().checkout.sessions.create({
    mode: subscription ? "subscription" : "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: input.organizationId,
    metadata,
    ...(subscription ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    ...(input.customerId ? { customer: input.customerId } : input.email ? { customer_email: input.email } : {}),
    success_url: `${input.origin}/settings/billing?checkout=success`,
    cancel_url: `${input.origin}/settings/billing?checkout=canceled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(customerId: string, origin: string): Promise<string> {
  const portal = await stripeClient().billingPortal.sessions.create({ customer: customerId, return_url: `${origin}/settings/billing` });
  return portal.url;
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));
const meta = (m: Stripe.Metadata | null | undefined) => m ?? {};

/** Signature-verified Stripe event → the billing change it stands for (null = not a billing change). */
export function normalizeStripeEvent(event: Stripe.Event): StripeBillingEvent | null {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      const m = meta(s.metadata);
      const ref = { organizationId: m.organizationId ?? s.client_reference_id ?? null, subscriptionId: idOf(s.subscription), customerId: idOf(s.customer) };
      if (m.kind === "pack" && isPackId(m.packId) && s.payment_status === "paid") return { ...ref, type: "pack_paid", sessionId: s.id, packId: m.packId, amountCents: s.amount_total ?? 0, currency: s.currency ?? "usd" };
      if (event.type !== "checkout.session.completed") return null;
      if (m.kind === "plan" && (m.plan === "starter" || m.plan === "enterprise")) return { ...ref, type: "plan_linked", plan: m.plan, billingInterval: m.billingInterval === "annual" ? "annual" : "monthly" };
      if (m.kind === "addon" && isAddonId(m.addonId)) return { ...ref, type: "addon_linked", addonId: m.addonId };
      return null;
    }
    case "invoice.paid": {
      const inv = event.data.object;
      const m = meta(inv.subscription_details?.metadata);
      const item = itemForPrice(inv.lines.data[0]?.price?.id);
      const plan = item?.kind === "plan" ? item.plan : m.kind === "plan" && isPlanTier(m.plan) ? m.plan : null;
      const addonId = item?.kind === "addon" ? item.addonId : m.kind === "addon" && isAddonId(m.addonId) ? m.addonId : null;
      if (!plan && !addonId) return null;
      const end = inv.lines.data[0]?.period?.end;
      return {
        organizationId: m.organizationId ?? null,
        subscriptionId: idOf(inv.subscription),
        customerId: idOf(inv.customer),
        type: "invoice_paid",
        invoiceId: inv.id,
        amountCents: inv.amount_paid,
        currency: inv.currency,
        firstOrRenewal: inv.billing_reason === "subscription_create" || inv.billing_reason === "subscription_cycle",
        plan: addonId ? null : plan,
        billingInterval: item?.kind === "plan" ? item.interval : m.billingInterval === "annual" ? "annual" : "monthly",
        addonId,
        periodEnd: end ? new Date(end * 1000) : null,
      };
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const item = itemForPrice(sub.items.data[0]?.price?.id);
      if (item?.kind !== "plan") return null;
      const status = sub.status === "canceled" || sub.status === "incomplete_expired" ? "canceled" : sub.status === "past_due" || sub.status === "unpaid" ? "past_due" : "active";
      return { organizationId: meta(sub.metadata).organizationId ?? null, subscriptionId: sub.id, customerId: idOf(sub.customer), type: "plan_updated", plan: item.plan, billingInterval: item.interval, status };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const m = meta(sub.metadata);
      const item = itemForPrice(sub.items.data[0]?.price?.id);
      const addonId = item?.kind === "addon" ? item.addonId : m.kind === "addon" && isAddonId(m.addonId) ? m.addonId : null;
      return { organizationId: m.organizationId ?? null, subscriptionId: sub.id, customerId: idOf(sub.customer), type: "subscription_canceled", addonId };
    }
    default:
      return null;
  }
}
