import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { billingMode, normalizeStripeEvent } from "./stripe-billing";

const ev = (type: string, object: Record<string, unknown>) => ({ id: "evt_1", type, data: { object } }) as unknown as Stripe.Event;
const ORG = "6f1d2c58-1b7e-4f53-9a3e-2d1f0c9b8a7e";

describe("Stripe billing events", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_STARTER_MONTHLY", "price_starter_m");
    vi.stubEnv("STRIPE_PRICE_ENTERPRISE_ANNUAL", "price_ent_y");
    vi.stubEnv("STRIPE_PRICE_ADDON_API_MCP", "price_api");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses Stripe when both keys are set and allows test mode only outside production", () => {
    expect(billingMode({})).toBe("off");
    expect(billingMode({ STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "whsec" })).toBe("stripe");
    expect(billingMode({ STRIPE_SECRET_KEY: "sk" })).toBe("off");
    expect(billingMode({ BILLING_TEST_MODE: "true", NODE_ENV: "development" })).toBe("test");
    expect(billingMode({ BILLING_TEST_MODE: "true", NODE_ENV: "production" })).toBe("off");
  });

  it("grants packs only for paid checkout sessions and links subscriptions without credits", () => {
    const pack = { id: "cs_1", metadata: { organizationId: ORG, kind: "pack", packId: "pack_5k" }, client_reference_id: ORG, subscription: null, customer: "cus_1", payment_status: "paid", amount_total: 34500, currency: "usd" };
    expect(normalizeStripeEvent(ev("checkout.session.completed", pack))).toMatchObject({ type: "pack_paid", organizationId: ORG, packId: "pack_5k", amountCents: 34500, sessionId: "cs_1" });
    expect(normalizeStripeEvent(ev("checkout.session.completed", { ...pack, payment_status: "unpaid" }))).toBeNull();
    expect(normalizeStripeEvent(ev("checkout.session.async_payment_succeeded", pack))).toMatchObject({ type: "pack_paid" });
    const plan = { ...pack, metadata: { organizationId: ORG, kind: "plan", plan: "starter", billingInterval: "monthly" }, subscription: "sub_1", amount_total: 29500 };
    expect(normalizeStripeEvent(ev("checkout.session.completed", plan))).toEqual({ type: "plan_linked", organizationId: ORG, subscriptionId: "sub_1", customerId: "cus_1", plan: "starter", billingInterval: "monthly" });
    // a forged plan name is not accepted
    expect(normalizeStripeEvent(ev("checkout.session.completed", { ...plan, metadata: { ...plan.metadata, plan: "platinum" } }))).toBeNull();
  });

  it("reads the plan from the invoiced price, so portal plan changes win over stale metadata", () => {
    const invoice = { id: "in_1", subscription: "sub_1", customer: "cus_1", amount_paid: 139200, currency: "usd", billing_reason: "subscription_cycle", subscription_details: { metadata: { organizationId: ORG, kind: "plan", plan: "starter", billingInterval: "monthly" } }, lines: { data: [{ price: { id: "price_ent_y" }, period: { end: 1798761600 } }] } };
    expect(normalizeStripeEvent(ev("invoice.paid", invoice))).toMatchObject({ type: "invoice_paid", invoiceId: "in_1", amountCents: 139200, plan: "enterprise", billingInterval: "annual", addonId: null, firstOrRenewal: true, periodEnd: new Date(1798761600 * 1000) });
    expect(normalizeStripeEvent(ev("invoice.paid", { ...invoice, billing_reason: "subscription_update" }))).toMatchObject({ firstOrRenewal: false });
    expect(normalizeStripeEvent(ev("invoice.paid", { ...invoice, lines: { data: [{ price: { id: "price_api" } }] } }))).toMatchObject({ plan: null, addonId: "api_mcp_addon" });
    expect(normalizeStripeEvent(ev("invoice.paid", { ...invoice, subscription_details: { metadata: {} }, lines: { data: [{ price: { id: "price_unknown" } }] } }))).toBeNull();
  });

  it("maps cancellations and ignores unrelated events", () => {
    const sub = { id: "sub_2", customer: "cus_1", metadata: { organizationId: ORG, kind: "addon", addonId: "api_mcp_addon" }, status: "canceled", items: { data: [{ price: { id: "price_api" } }] } };
    expect(normalizeStripeEvent(ev("customer.subscription.deleted", sub))).toEqual({ type: "subscription_canceled", organizationId: ORG, subscriptionId: "sub_2", customerId: "cus_1", addonId: "api_mcp_addon" });
    expect(normalizeStripeEvent(ev("customer.subscription.updated", { ...sub, status: "active", items: { data: [{ price: { id: "price_starter_m" } }] } }))).toMatchObject({ type: "plan_updated", plan: "starter", billingInterval: "monthly", status: "active" });
    expect(normalizeStripeEvent(ev("payment_method.attached", {}))).toBeNull();
  });
});
