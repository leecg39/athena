import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { users, orgMembers, websiteMembers, customRoles, prompts, competitors, responses, shoppingProducts, adsImpressions } from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { detectShoppingCard } from "../extract";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import {
  syncShoppingInsights,
  getShoppingInsightsSummary,
  createShoppingProduct,
  deleteShoppingProduct,
  detectSponsoredAds,
  captureSponsoredAds,
  getAdsSummary,
  recordAdImpression,
  deleteAdImpression,
} from "./index";

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000);

describe("commerce: shopping cards and sponsored placements from collected answers", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let promptId: string;
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string; promptId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "commerce-owner@example.com", name: "Commerce Owner" });
    const site = await createWebsite(t.db, { organizationId, userId: user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: user.id, websiteId: site.id };
    await t.db.insert(competitors).values([{ websiteId: site.id, domain: "figma.com", name: "Figma" }]);
    const [p] = await t.db.insert(prompts).values({ websiteId: site.id, text: "best drawing kit", type: "non_branded" }).returning();
    promptId = p.id;
    const answer = async (model: string, rawText: string, ranAt: Date) => {
      await t.db.insert(responses).values({ websiteId: site.id, promptId, model, rawText, ranAt, shoppingCard: detectShoppingCard(rawText) });
    };
    await answer("chatgpt", "1. **Canvasly Sketch Kit** — $49 at Amazon\n2. **Figma Tablet Stand** — $35 at Best Buy\n3. Wacom Pen — $79 at Amazon", day(3));
    await answer("chatgpt", "1. **Figma Tablet Stand** — $33 at Amazon\n2. **Canvasly Sketch Kit** — $49 at Amazon", day(2));
    await answer("chatgpt", "Canvasly is a good choice for teams.", day(1));
    await answer("ai_overview", "Sponsored · canva.com — Canva Teams: design together\nOther text", day(1));
    await answer("perplexity", "Sponsored · miro.com — Miro boards", day(1));

    const [viewer] = await t.db.insert(users).values({ email: "commerce-viewer@example.com", name: "Viewer" }).returning();
    const [role] = await t.db.insert(customRoles).values({ organizationId, name: "Commerce Reader", permissions: ["websites:read", "content:read"] }).returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;
    const o = await ensureUserWithOrg(t.db, { email: "commerce-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "outsider.io", name: "Outsider" });
    const [oPrompt] = await t.db.insert(prompts).values({ websiteId: oSite.id, text: "confidential outsider prompt", type: "branded" }).returning();
    outsider = { actorId: o.user.id, websiteId: oSite.id, promptId: oPrompt.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("never writes while viewing and starts empty", async () => {
    const empty = await getShoppingInsightsSummary(t.db, c);
    expect(empty.products).toEqual([]);
    expect((await getAdsSummary(t.db, c)).impressions).toEqual([]);
    expect(await t.db.select().from(shoppingProducts).where(eq(shoppingProducts.websiteId, c.websiteId))).toHaveLength(0);
    expect(await t.db.select().from(adsImpressions).where(eq(adsImpressions.websiteId, c.websiteId))).toHaveLength(0);
  });

  it("builds shopping insights only from product cards in collected answers", async () => {
    expect(await syncShoppingInsights(t.db, c)).toMatchObject({ created: 3, updated: 0 });
    expect(await syncShoppingInsights(t.db, c)).toMatchObject({ created: 0, updated: 3 });
    const summary = await getShoppingInsightsSummary(t.db, c);
    const byTitle = new Map(summary.products.map((p) => [p.title, p]));
    expect([...byTitle.keys()].sort()).toEqual(["Canvasly Sketch Kit", "Figma Tablet Stand", "Wacom Pen"]);
    expect(byTitle.get("Canvasly Sketch Kit")).toMatchObject({ isOwn: true, appearances: 2, avgPosition: 1.5, price: 49, retailer: "Amazon" });
    // latest answer wins for price and (on a tie) retailer
    expect(byTitle.get("Figma Tablet Stand")).toMatchObject({ isOwn: false, appearances: 2, avgPosition: 1.5, price: 33, retailer: "Amazon" });
    expect(byTitle.get("Wacom Pen")).toMatchObject({ isOwn: false, appearances: 1, avgPosition: 3, price: 79 });
    expect(summary.stats).toMatchObject({ totalAppearances: 5, ownAppearances: 2, ownSharePct: 40 });
  });

  it("supports manual products without invented numbers, with RBAC and tenant isolation", async () => {
    const added = await createShoppingProduct(t.db, { ...c, title: "Canvasly Starter Pack", retailer: "Amazon", price: 9.5, isOwn: true });
    expect(added).toMatchObject({ title: "Canvasly Starter Pack", appearances: 0 });
    await expect(createShoppingProduct(t.db, { ...c, title: "Canvasly Starter Pack", retailer: "Amazon", price: 9.5, isOwn: true })).rejects.toThrow(DomainError);
    await expect(syncShoppingInsights(t.db, { actorId: viewerId, websiteId: c.websiteId })).rejects.toThrow(ForbiddenError);
    await expect(getShoppingInsightsSummary(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();
    await expect(getShoppingInsightsSummary(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toThrow(ForbiddenError);
    await expect(deleteShoppingProduct(t.db, { actorId: viewerId, websiteId: c.websiteId, productId: added.id })).rejects.toThrow(ForbiddenError);
    await deleteShoppingProduct(t.db, { ...c, productId: added.id });
  });

  it("detects explicitly labelled sponsored placements only", () => {
    expect(detectSponsoredAds("Sponsored · canva.com — Canva Teams: design together")).toEqual([{ advertiser: "canva.com", adText: "canva.com — Canva Teams: design together" }]);
    expect(detectSponsoredAds("[Sponsored] Framer AI — publish sites\nnormal line")).toEqual([{ advertiser: "Framer AI", adText: "Framer AI — publish sites" }]);
    expect(detectSponsoredAds("Figma is sponsored by many teams and widely used.")).toEqual([]);
  });

  it("captures sponsored placements from supported surfaces and keeps manual records", async () => {
    expect(await captureSponsoredAds(t.db, c)).toMatchObject({ captured: 1 });
    expect(await captureSponsoredAds(t.db, c)).toMatchObject({ captured: 0 });
    const ads = await getAdsSummary(t.db, c);
    expect(ads.impressions.map((i) => [i.surface, i.advertiser])).toEqual([["ai_overview", "canva.com"]]);
    await expect(captureSponsoredAds(t.db, { actorId: viewerId, websiteId: c.websiteId })).rejects.toThrow(ForbiddenError);

    await expect(recordAdImpression(t.db, { ...c, promptId: outsider.promptId, surface: "chatgpt", advertiser: "Malicious", adText: "cross-tenant prompt" })).rejects.toThrow(NotFoundError);
    const manual = await recordAdImpression(t.db, { ...c, promptId, surface: "ai_mode", advertiser: "Sketch", adText: "Sketch for Mac & Web" });
    expect((await getAdsSummary(t.db, { ...c, filters: { surface: "ai_mode" } })).impressions.map((i) => i.id)).toEqual([manual.id]);
    await deleteAdImpression(t.db, { ...c, impressionId: manual.id });
  });
});
