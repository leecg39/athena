import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import {
  users,
  orgMembers,
  websiteMembers,
  customRoles,
  prompts,
  competitors,
  shoppingProducts,
} from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import {
  syncShoppingInsights,
  getShoppingInsightsSummary,
  createShoppingProduct,
  deleteShoppingProduct,
  captureSponsoredAds,
  getAdsSummary,
  recordAdImpression,
  deleteAdImpression,
} from "./index";

describe("shopping insights (carousel analytics, brand comparison, retailer distribution) & sponsored ads capture", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string; promptId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string; promptId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, {
      email: "commerce-owner@example.com",
      name: "Commerce Owner",
    });
    const site = await createWebsite(t.db, {
      organizationId,
      userId: user.id,
      domain: "canvasly.io",
      name: "Canvasly",
    });

    await t.db.insert(competitors).values([
      { websiteId: site.id, domain: "figma.com", name: "Figma" },
      { websiteId: site.id, domain: "canva.com", name: "Canva" },
    ]);

    const [pRow] = await t.db
      .insert(prompts)
      .values({
        websiteId: site.id,
        text: "best ai design software for product teams",
        type: "non_branded",
        volumeEstimate: 3200,
      })
      .returning();

    c = { actorId: user.id, websiteId: site.id, promptId: pRow!.id };

    // Viewer user
    const [vUser] = await t.db
      .insert(users)
      .values({ email: "commerce-viewer@example.com", name: "Commerce Viewer" })
      .returning();
    const [vRole] = await t.db
      .insert(customRoles)
      .values({
        organizationId,
        name: "CommerceViewerRole",
        permissions: ["websites:read", "content:read"],
      })
      .returning();
    await t.db.insert(orgMembers).values({
      organizationId,
      userId: vUser!.id,
      role: "custom",
      customRoleId: vRole!.id,
    });
    await t.db.insert(websiteMembers).values({
      websiteId: site.id,
      userId: vUser!.id,
      role: "member",
    });
    viewerId = vUser!.id;

    // Outsider tenant
    const outOrg = await ensureUserWithOrg(t.db, {
      email: "commerce-outsider@example.com",
      name: "Outsider",
    });
    const outSite = await createWebsite(t.db, {
      organizationId: outOrg.organizationId,
      userId: outOrg.user.id,
      domain: "outsider.io",
      name: "OutsiderBrand",
    });
    const [outPrompt] = await t.db
      .insert(prompts)
      .values({
        websiteId: outSite.id,
        text: "confidential outsider prompt",
        type: "branded",
      })
      .returning();
    outsider = { actorId: outOrg.user.id, websiteId: outSite.id, promptId: outPrompt!.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("syncs shopping insights while preserving catalog-optimized product titles and computes brand + retailer analytics", async () => {
    // Seed an already-optimized own product (` — Verified AI Collaborative Suite`)
    await t.db.insert(shoppingProducts).values({
      websiteId: c.websiteId,
      title: "Canvasly AI Design Canvas Pro — Verified AI Collaborative Suite",
      retailer: "Shopify",
      price: "29.00",
      appearances: 18,
      avgPosition: "1.40",
      isOwn: true,
    });

    const syncRes = await syncShoppingInsights(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
    });
    expect(syncRes.updated).toBeGreaterThanOrEqual(1);
    expect(syncRes.created).toBeGreaterThanOrEqual(4);

    const summary = await getShoppingInsightsSummary(t.db, c.websiteId);
    expect(summary.stats.ownProductCount).toBeGreaterThanOrEqual(4);
    expect(summary.stats.competitorProductCount).toBeGreaterThanOrEqual(4);
    expect(summary.stats.retailerCoverageCount).toBeGreaterThanOrEqual(3);

    // Ensure the optimized title was preserved and not duplicated
    const proMatches = summary.products.filter((p) =>
      p.title.toLowerCase().includes("ai design canvas pro"),
    );
    expect(proMatches.length).toBe(1);
    expect(proMatches[0]!.title).toContain("Verified AI Collaborative Suite");

    // Verify brandComparison includes Canvasly (own) and Figma/Canva (competitors)
    expect(summary.brandComparison.some((b) => b.isOwn && b.brand === "Canvasly")).toBe(true);
    expect(summary.brandComparison.some((b) => !b.isOwn && b.brand === "Figma")).toBe(true);

    // Verify retailerDistribution sums to totalAppearances
    const distSum = summary.retailerDistribution.reduce((a, r) => a + r.totalAppearances, 0);
    expect(distSum).toBe(summary.stats.totalAppearances);
  });

  it("supports manual shopping product CRUD, prevents duplicates, and enforces RBAC & tenant isolation", async () => {
    const added = await createShoppingProduct(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      title: "Canvasly Starter Pack",
      retailer: "Amazon",
      price: 9.5,
      appearances: 220,
      avgPosition: 1.5,
      isOwn: true,
    });
    expect(added.title).toBe("Canvasly Starter Pack");

    // Duplicate check
    await expect(
      createShoppingProduct(t.db, {
        actorId: c.actorId,
        websiteId: c.websiteId,
        title: "Canvasly Starter Pack",
        retailer: "Amazon",
        price: 9.5,
        appearances: 220,
        avgPosition: 1.5,
        isOwn: true,
      }),
    ).rejects.toThrow(DomainError);

    // Viewer blocked
    await expect(
      deleteShoppingProduct(t.db, {
        actorId: viewerId,
        websiteId: c.websiteId,
        productId: added.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    // Outsider blocked
    await expect(
      deleteShoppingProduct(t.db, {
        actorId: outsider.actorId,
        websiteId: c.websiteId,
        productId: added.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    await deleteShoppingProduct(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      productId: added.id,
    });
  });

  it("captures sponsored ads across ChatGPT, AI Mode, and AI Overview, is idempotent, and blocks cross-tenant prompt linking", async () => {
    const cap1 = await captureSponsoredAds(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
    });
    expect(cap1.captured).toBeGreaterThanOrEqual(6);

    // Re-running is idempotent (updates seenAt without creating duplicates)
    const cap2 = await captureSponsoredAds(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
    });
    expect(cap2.captured).toBe(0);
    expect(cap2.updated).toBe(cap1.captured);

    const ads = await getAdsSummary(t.db, c.websiteId);
    expect(ads.stats.totalImpressions).toBe(cap1.captured);
    expect(ads.stats.surfaceCounts.chatgpt).toBeGreaterThan(0);
    expect(ads.stats.surfaceCounts.ai_mode).toBeGreaterThan(0);
    expect(ads.stats.surfaceCounts.ai_overview).toBeGreaterThan(0);

    // Surface filtering works
    const chatgptOnly = await getAdsSummary(t.db, c.websiteId, { surface: "chatgpt" });
    expect(chatgptOnly.impressions.every((i) => i.surface === "chatgpt")).toBe(true);

    // Cross-tenant promptId injection must be rejected!
    await expect(
      recordAdImpression(t.db, {
        actorId: c.actorId,
        websiteId: c.websiteId,
        promptId: outsider.promptId,
        surface: "chatgpt",
        advertiser: "Malicious Ad",
        adText: "Trying to read outsider prompt via leftJoin",
      }),
    ).rejects.toThrow(NotFoundError);

    // Valid manual ad capture + deletion
    const manualAd = await recordAdImpression(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      promptId: c.promptId,
      surface: "ai_mode",
      advertiser: "Sketch",
      adText: "[Sponsored · AI Mode] Sketch for Mac & Web — Real-time collaboration",
    });
    expect(manualAd.id).toBeTruthy();

    // Deleting a prompt referenced by ads_impressions sets promptId to NULL (no FK error)
    const [tempPrompt] = await t.db
      .insert(prompts)
      .values({
        websiteId: c.websiteId,
        text: "temporary prompt for ad deletion test",
        type: "non_branded",
      })
      .returning();
    const linkedAd = await recordAdImpression(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      promptId: tempPrompt!.id,
      surface: "ai_overview",
      advertiser: "Framer",
      adText: "[Sponsored · AI Overview] Design and publish with Framer AI",
    });
    await t.db.delete(prompts).where(eq(prompts.id, tempPrompt!.id));

    const afterPromptDel = await getAdsSummary(t.db, c.websiteId);
    const survived = afterPromptDel.impressions.find((i) => i.id === linkedAd.id);
    expect(survived).toBeDefined();
    expect(survived?.promptId).toBeNull();

    await deleteAdImpression(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      impressionId: manualAd.id,
    });
  });
});
