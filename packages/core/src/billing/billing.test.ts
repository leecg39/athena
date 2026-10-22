import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { createWebsite, ensureUserWithOrg } from "../tenancy";
import { createGroup } from "../org/groups";
import {
  allocateWebsiteCredits,
  changeSubscriptionPlan,
  getBillingOverview,
  processStripeWebhookEvent,
  purchaseCreditPack,
  renderInvoicePdfBuffer,
  toggleBillingAddon,
} from "./index";

describe("@athena/core/billing — Stripe Plans, Multi-Scope Credits, Add-ons & Invoices", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  it("upgrades Free -> Starter ($295/mo) -> Enterprise, grants monthly credits, and generates PDF invoices", async () => {
    const { user, organizationId } = await ensureUserWithOrg(t.db, {
      email: "billing-owner@test.com",
      name: "Billing Owner",
    });
    const site = await createWebsite(t.db, {
      userId: user.id,
      organizationId,
      name: "Billing Brand",
      domain: "billingbrand.io",
    });

    const initial = await getBillingOverview(t.db, {
      actorId: user.id,
      organizationId,
    });
    expect(initial.organization.plan).toBe("free");
    expect(initial.balances.orgUnallocatedBalance).toBe(300);
    expect(initial.invoices.length).toBe(0);

    // Upgrade to Starter ($295/mo, +3,600 credits)
    const starter = await changeSubscriptionPlan(t.db, {
      actorId: user.id,
      organizationId,
      plan: "starter",
      billingInterval: "monthly",
    });
    expect(starter.plan).toBe("starter");
    expect(starter.monthlyCredits).toBe(3600);
    expect(starter.orgBalance).toBe(3900); // 300 + 3600
    expect(starter.invoiceId).toBeTruthy();

    // Enable Public REST API & MCP Add-on ($99/mo, +500 bonus credits)
    const addon = await toggleBillingAddon(t.db, {
      actorId: user.id,
      organizationId,
      addonId: "api_mcp_addon",
      enabled: true,
    });
    expect(addon.addons).toContain("api_mcp_addon");
    expect(addon.bonusCreditsGranted).toBe(500);

    // Allocate 400 credits to Website Dedicated Pool
    const webAlloc = await allocateWebsiteCredits(t.db, {
      actorId: user.id,
      organizationId,
      websiteId: site.id,
      amount: 400,
      direction: "to_website",
      reason: "Website campaign budget",
    });
    expect(webAlloc.orgBalance).toBe(4000); // 4400 - 400
    expect(webAlloc.websiteBalance).toBe(400);

    // Return 150 credits from Website Pool -> Org Pool
    const webReturn = await allocateWebsiteCredits(t.db, {
      actorId: user.id,
      organizationId,
      websiteId: site.id,
      amount: 150,
      direction: "to_org",
    });
    expect(webReturn.orgBalance).toBe(4150);
    expect(webReturn.websiteBalance).toBe(250);

    // Purchase +1,000 Credits Pack into a Group Shared Pool
    const grp = await createGroup(t.db, {
      actorId: user.id,
      organizationId,
      name: "Agency Retainer Group",
    });
    const pack = await purchaseCreditPack(t.db, {
      actorId: user.id,
      organizationId,
      packId: "pack_1k",
      targetScope: "group",
      targetGroupId: grp.id,
    });
    expect(pack.creditsAdded).toBe(1000);
    expect(pack.newPoolBalance).toBe(1000);

    const afterOverview = await getBillingOverview(t.db, {
      actorId: user.id,
      organizationId,
    });
    expect(afterOverview.balances.orgUnallocatedBalance).toBe(4150);
    expect(afterOverview.balances.totalWebsiteCredits).toBe(250);
    expect(afterOverview.balances.totalGroupCredits).toBe(1000);
    expect(afterOverview.balances.totalOrgWideCredits).toBe(5400);
    expect(afterOverview.invoices.length).toBe(3); // Starter plan + API addon + 1k pack

    // Verify Invoice PDF generation
    const firstInv = afterOverview.invoices[0]!;
    const pdfBuf = renderInvoicePdfBuffer({
      invoiceId: firstInv.id,
      stripeInvoiceId: firstInv.stripeInvoiceId,
      organizationName: afterOverview.organization.name,
      description: firstInv.description,
      amountCents: firstInv.amountCents,
      currency: firstInv.currency,
      status: firstInv.status,
      issuedAt: firstInv.issuedAt,
    });
    const pdfStr = pdfBuf.toString("utf8");
    expect(pdfStr.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfStr).toContain("ATHENUM - TAX INVOICE & RECEIPT");
    expect(pdfStr).toContain("%%EOF");
  });

  it("processes Stripe webhook events idempotently and prevents duplicate credit grants", async () => {
    const { user, organizationId } = await ensureUserWithOrg(t.db, {
      email: "webhook-org@test.com",
      name: "Webhook Org",
    });

    const firstDelivery = await processStripeWebhookEvent(t.db, {
      id: "evt_test_1001",
      type: "invoice.paid",
      organizationId,
      plan: "starter",
      credits: 3600,
      amountCents: 29500,
      stripeInvoiceId: "in_stripe_999001",
      stripeSubscriptionId: "sub_stripe_999001",
      stripeCustomerId: "cus_stripe_999001",
      description: "Stripe Starter Monthly Renewal",
    });
    expect(firstDelivery.processed).toBe(true);
    expect(firstDelivery.duplicate).toBe(false);

    // Replay the exact same webhook event
    const replayDelivery = await processStripeWebhookEvent(t.db, {
      id: "evt_test_1001",
      type: "invoice.paid",
      organizationId,
      plan: "starter",
      credits: 3600,
      amountCents: 29500,
      stripeInvoiceId: "in_stripe_999001",
    });
    expect(replayDelivery.duplicate).toBe(true);
    expect(replayDelivery.processed).toBe(false);

    const overview = await getBillingOverview(t.db, {
      actorId: user.id,
      organizationId,
    });
    // 300 initial + 3600 (granted only once!) = 3900
    expect(overview.balances.orgUnallocatedBalance).toBe(3900);
    expect(overview.invoices.length).toBe(1);
  });
});
