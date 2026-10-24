import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { invoices, organizations } from "@athena/db";
import { createWebsite, ensureUserWithOrg } from "../tenancy";
import { DomainError } from "../org/errors";
import {
  allocateWebsiteCredits,
  getBillingOverview,
  getOrgBalance,
  processStripeWebhookEvent,
  renderInvoicePdfBuffer,
  testBillingEnabled,
  testBuyPack,
  testChangePlan,
  testToggleAddon,
} from "./index";

const DEV = { BILLING_TEST_MODE: "true", NODE_ENV: "development" };
const ref = { organizationId: null, subscriptionId: null, customerId: null };

describe("billing: Stripe-confirmed changes only, opt-in test mode", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("allows test-mode changes only outside production when enabled, and records them as not charged", async () => {
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "billing-test@test.com" });
    const c = { actorId: user.id, organizationId };
    const initial = await getBillingOverview(t.db, c);
    expect(initial).toMatchObject({ organization: { plan: "free" }, balances: { orgUnallocatedBalance: 300 }, invoices: [], subscription: { currentPeriodEnd: null, stripeSubscriptionId: null } });

    expect(testBillingEnabled({})).toBe(false);
    expect(testBillingEnabled({ BILLING_TEST_MODE: "true", NODE_ENV: "production" })).toBe(false);
    await expect(testChangePlan(t.db, { ...c, plan: "enterprise", env: {} })).rejects.toThrow(/Stripe Checkout/);
    await expect(testChangePlan(t.db, { ...c, plan: "enterprise", env: { BILLING_TEST_MODE: "true", NODE_ENV: "production" } })).rejects.toThrow(DomainError);
    await expect(testBuyPack(t.db, { ...c, packId: "pack_15k", env: {} })).rejects.toThrow(/Stripe Checkout/);
    expect(await getOrgBalance(t.db, organizationId)).toBe(300);

    expect(await testChangePlan(t.db, { ...c, plan: "starter", env: DEV })).toMatchObject({ previous: "free", creditsGranted: 3600 });
    // re-selecting the same plan grants nothing
    expect(await testChangePlan(t.db, { ...c, plan: "starter", env: DEV })).toMatchObject({ creditsGranted: 0 });
    // add-ons only switch features in test mode (no enable/disable credit loop)
    await testToggleAddon(t.db, { ...c, addonId: "api_mcp_addon", enabled: true, env: DEV });
    await testToggleAddon(t.db, { ...c, addonId: "api_mcp_addon", enabled: false, env: DEV });
    await testToggleAddon(t.db, { ...c, addonId: "api_mcp_addon", enabled: true, env: DEV });
    expect(await testBuyPack(t.db, { ...c, packId: "pack_1k", env: DEV })).toMatchObject({ creditsAdded: 1000, orgBalance: 4900 });

    const overview = await getBillingOverview(t.db, c);
    expect(overview.subscription).toMatchObject({ plan: "starter", addons: ["api_mcp_addon"], stripeSubscriptionId: null, stripeCustomerId: null });
    expect(overview.invoices.map((i) => [i.status, i.amountCents, i.stripeInvoiceId])).toEqual([["test", 0, null], ["test", 0, null]]);
    expect(overview.invoices.every((i) => i.description.includes("not charged"))).toBe(true);
    const pdf = renderInvoicePdfBuffer({ invoiceId: overview.invoices[0]!.id, stripeInvoiceId: null, organizationName: "Org", description: overview.invoices[0]!.description, amountCents: 0, currency: "usd", status: "test", issuedAt: new Date() }).toString("utf8");
    expect(pdf).toContain("TEST MODE");
    expect(pdf).toContain("NOT CHARGED, NOT A RECEIPT");
    expect(pdf).not.toContain("ATHENUM - RECEIPT");

    // moving credits between pools creates none
    const site = await createWebsite(t.db, { userId: user.id, organizationId, name: "Brand", domain: "billingbrand.io" });
    expect(await allocateWebsiteCredits(t.db, { ...c, websiteId: site.id, amount: 400, direction: "to_website" })).toMatchObject({ orgBalance: 4500, websiteBalance: 400 });
    expect(await allocateWebsiteCredits(t.db, { ...c, websiteId: site.id, amount: 150, direction: "to_org" })).toMatchObject({ orgBalance: 4650, websiteBalance: 250 });
    expect((await getBillingOverview(t.db, c)).balances.totalOrgWideCredits).toBe(4900);
  });

  it("applies Stripe events once: plan link, paid periods, packs, add-ons and cancellation", async () => {
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "billing-stripe@test.com" });
    const c = { actorId: user.id, organizationId };
    expect(await processStripeWebhookEvent(t.db, { ...ref, type: "plan_linked", organizationId, subscriptionId: "sub_plan", customerId: "cus_1", plan: "starter", billingInterval: "monthly" })).toEqual({ processed: true });
    // linking alone grants nothing
    expect(await getOrgBalance(t.db, organizationId)).toBe(300);

    // the invoice carries no organization metadata: it is resolved from the stored subscription id
    const paid = { ...ref, type: "invoice_paid" as const, subscriptionId: "sub_plan", customerId: "cus_1", invoiceId: "in_1", amountCents: 29500, currency: "usd", firstOrRenewal: true, plan: "starter" as const, billingInterval: "monthly" as const, addonId: null, periodEnd: new Date("2026-12-01T00:00:00Z") };
    expect(await processStripeWebhookEvent(t.db, paid)).toEqual({ processed: true });
    expect(await processStripeWebhookEvent(t.db, paid)).toEqual({ processed: false, reason: "duplicate invoice" });
    expect(await getOrgBalance(t.db, organizationId)).toBe(3900);
    await processStripeWebhookEvent(t.db, { ...paid, invoiceId: "in_2" });
    expect(await getOrgBalance(t.db, organizationId)).toBe(7500);
    // a proration invoice records the payment without a second allowance
    await processStripeWebhookEvent(t.db, { ...paid, invoiceId: "in_3", amountCents: 1200, firstOrRenewal: false });
    expect(await getOrgBalance(t.db, organizationId)).toBe(7500);

    const pack = { ...ref, type: "pack_paid" as const, organizationId, sessionId: "abc", packId: "pack_1k" as const, amountCents: 7900, currency: "usd" };
    expect(await processStripeWebhookEvent(t.db, pack)).toEqual({ processed: true });
    expect(await processStripeWebhookEvent(t.db, pack)).toMatchObject({ processed: false });
    expect(await getOrgBalance(t.db, organizationId)).toBe(8500);

    await processStripeWebhookEvent(t.db, { ...ref, type: "addon_linked", organizationId, subscriptionId: "sub_addon", addonId: "api_mcp_addon" });
    await processStripeWebhookEvent(t.db, { ...paid, organizationId, subscriptionId: "sub_addon", invoiceId: "in_4", amountCents: 9900, plan: null, addonId: "api_mcp_addon" });
    expect(await getOrgBalance(t.db, organizationId)).toBe(9000);
    let overview = await getBillingOverview(t.db, c);
    expect(overview.subscription).toMatchObject({ plan: "starter", addons: ["api_mcp_addon"], stripeSubscriptionId: "sub_plan", stripeCustomerId: "cus_1" });
    expect(overview.invoices.map((i) => [i.stripeInvoiceId, i.amountCents, i.status])).toEqual(expect.arrayContaining([["in_1", 29500, "paid"], ["in_3", 1200, "paid"], ["cs_abc", 7900, "paid"], ["in_4", 9900, "paid"]]));
    const [inv] = await t.db.select().from(invoices).where(eq(invoices.stripeInvoiceId, "in_1"));
    expect(renderInvoicePdfBuffer({ invoiceId: inv!.id, stripeInvoiceId: "in_1", organizationName: "Org", description: inv!.description ?? "", amountCents: 29500, currency: "usd", status: "paid", issuedAt: inv!.issuedAt }).toString("utf8")).toContain("ATHENUM - RECEIPT");

    await processStripeWebhookEvent(t.db, { ...ref, type: "subscription_canceled", organizationId, subscriptionId: "sub_addon", addonId: "api_mcp_addon" });
    // a cancellation of some other subscription does not downgrade the plan
    expect(await processStripeWebhookEvent(t.db, { ...ref, type: "subscription_canceled", organizationId, subscriptionId: "sub_old", addonId: null })).toMatchObject({ processed: false });
    await processStripeWebhookEvent(t.db, { ...ref, type: "subscription_canceled", subscriptionId: "sub_plan", addonId: null });
    overview = await getBillingOverview(t.db, c);
    expect(overview.subscription).toMatchObject({ plan: "free", status: "canceled", addons: [] });
    expect((await t.db.select().from(organizations).where(eq(organizations.id, organizationId)))[0]!.plan).toBe("free");

    expect(await processStripeWebhookEvent(t.db, { ...paid, subscriptionId: "sub_unknown", customerId: "cus_unknown", invoiceId: "in_9" })).toMatchObject({ processed: false });
  });
});
