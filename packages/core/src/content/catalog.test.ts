import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { users, orgMembers, websiteMembers, customRoles, shoppingProducts } from "@athena/db";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError } from "../org/errors";
import { upsertPublishTarget, syncShopifyCatalog, listCatalogProducts, saveCatalogDraft, applyCatalogOptimizationToShopify, catalogScores, type CmsRequest } from "./index";

const KEY = "test-integrations-key-0123456789abcdef";
const PRODUCTS = { products: [
  { id: 101, title: "Canvasly Sketch Kit", body_html: "<p>A sketch kit.</p>", handle: "sketch-kit", variants: [{ price: "49.00" }] },
  { id: 102, title: "Canvasly Pro Pens", body_html: "<ul><li>Fine tips</li><li>Pack of 12</li></ul>", handle: "pro-pens", variants: [{ price: "12.50" }] },
  { title: "No id — skipped" },
] };

describe("Shopify catalog optimization", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let other: { actorId: string; websiteId: string };
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  let putStatus = 200;
  const shopify: CmsRequest = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (init.method === "GET") return { status: 200, body: JSON.stringify(PRODUCTS) };
    return { status: putStatus, body: JSON.stringify(putStatus === 200 ? { product: { id: 101 } } : { errors: { title: ["is too long"] } }) };
  };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "catalog-owner@example.com", name: "Owner" });
    const site = await createWebsite(t.db, { organizationId, userId: user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: user.id, websiteId: site.id };
    await upsertPublishTarget(t.db, { ...c, provider: "shopify", secretKey: KEY, config: { storeDomain: "canvasly.myshopify.com", blogId: "1", accessToken: "shpat_abc" } });
    // what AI answers showed (Shopping Insights)
    await t.db.insert(shoppingProducts).values({ websiteId: site.id, title: "Canvasly Sketch Kit", retailer: "Amazon", price: "49.00", appearances: 2, avgPosition: "1.50", isOwn: true, lastSeenAt: new Date() });
    const [viewer] = await t.db.insert(users).values({ email: "catalog-viewer@example.com", name: "Viewer" }).returning();
    const [role] = await t.db.insert(customRoles).values({ organizationId, name: "Catalog Reader", permissions: ["websites:read", "content:read"] }).returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;
    const o = await ensureUserWithOrg(t.db, { email: "catalog-other@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
    other = { actorId: o.user.id, websiteId: oSite.id };
  });
  afterAll(async () => {
    await t.close();
  });

  it("scores listings with explainable rules (no randomness)", () => {
    expect(catalogScores("Canvasly Sketch Kit — 24 Pencils", "", "Canvasly")).toEqual({ titleScore: 100, descScore: 0, faqStatus: "missing" });
    expect(catalogScores("KIT", "A kit for artists with 24 pencils.\n- Graphite\n- Charcoal", "Canvasly")).toEqual({ titleScore: 0, descScore: 64, faqStatus: "missing" });
    expect(catalogScores("Kit", "Q: Is it refillable?\nA: Yes.\nQ: Does it ship worldwide?\nA: Yes.", "Canvasly").faqStatus).toBe("ok");
    // one question line counts once
    expect(catalogScores("Kit", "Q: Is it refillable?\nA: Yes.", "Canvasly").faqStatus).toBe("missing");
    // titles without Latin letters are not "shouting"
    expect(catalogScores("캔버슬리 스케치 키트 프로페셔널 에디션", "", "캔버슬리").titleScore).toBe(60);
  });

  it("syncs real products from the Shopify Admin API", async () => {
    expect((await listCatalogProducts(t.db, c))).toMatchObject({ products: [], shopifyConnected: true, storeDomain: "canvasly.myshopify.com" });
    await expect(syncShopifyCatalog(t.db, { ...other, secretKey: KEY, request: shopify })).rejects.toThrow(/Connect Shopify/);
    expect(await syncShopifyCatalog(t.db, { ...c, secretKey: KEY, request: shopify })).toMatchObject({ created: 2, updated: 0 });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://canvasly.myshopify.com/admin/api/2025-01/products.json?limit=250", headers: { "x-shopify-access-token": "shpat_abc" } });
    expect(await syncShopifyCatalog(t.db, { ...c, secretKey: KEY, request: shopify })).toMatchObject({ created: 0, updated: 2 });
    const list = await listCatalogProducts(t.db, c);
    const kit = list.products.find((p) => p.title === "Canvasly Sketch Kit")!;
    expect(list.products).toHaveLength(2);
    // prices stay in the store's currency, as Shopify returns them
    expect(kit).toMatchObject({ price: "49.00", appearances: 2, avgPosition: 1.5, optimizationStatus: "needs_optimization", currentDescription: "A sketch kit.", ...catalogScores("Canvasly Sketch Kit", "A sketch kit.", "Canvasly") });
    expect(list.products.find((p) => p.title === "Canvasly Pro Pens")).toMatchObject({ price: "12.50", appearances: 0, currentDescription: "- Fine tips\n- Pack of 12" });
  });

  it("stores recommendations and applies them only when Shopify accepts the update", async () => {
    const kit = (await listCatalogProducts(t.db, c)).products.find((p) => p.title === "Canvasly Sketch Kit")!;
    await saveCatalogDraft(t.db, { ...c, productId: kit.id, title: "Canvasly Sketch Kit — 24 Pencils", description: "A sketch kit with **24 pencils**.", faq: "Q: Is it refillable?\nA: Yes.", source: "anthropic" });
    const drafted = (await listCatalogProducts(t.db, c)).products.find((p) => p.id === kit.id)!;
    expect(drafted).toMatchObject({ optimizationStatus: "draft_ready", recommendedTitle: "Canvasly Sketch Kit — 24 Pencils", version: 1 });
    // saving the same copy again does not create a new version
    expect(await saveCatalogDraft(t.db, { ...c, productId: kit.id, title: "Canvasly Sketch Kit — 24 Pencils", description: "A sketch kit with **24 pencils**.", faq: "Q: Is it refillable?\nA: Yes.", source: "manual" })).toMatchObject({ version: 1 });

    putStatus = 422;
    await expect(applyCatalogOptimizationToShopify(t.db, { ...c, productId: kit.id, secretKey: KEY, request: shopify })).rejects.toThrow(/rejected.*422.*too long/);
    expect((await listCatalogProducts(t.db, c)).products.find((p) => p.id === kit.id)!.optimizationStatus).toBe("draft_ready");
    putStatus = 200;
    await applyCatalogOptimizationToShopify(t.db, { ...c, productId: kit.id, secretKey: KEY, request: shopify });
    const put = calls.at(-1)!;
    expect(put).toMatchObject({ method: "PUT", url: "https://canvasly.myshopify.com/admin/api/2025-01/products/101.json" });
    expect(put.body).toEqual({ product: { id: 101, title: "Canvasly Sketch Kit — 24 Pencils", body_html: "<p>A sketch kit with <strong>24 pencils</strong>.</p>\n<h2>FAQ</h2>\n<p>Q: Is it refillable?</p>\n<p>A: Yes.</p>" } });
    const applied = (await listCatalogProducts(t.db, c)).products.find((p) => p.id === kit.id)!;
    expect(applied).toMatchObject({ optimizationStatus: "published", title: "Canvasly Sketch Kit — 24 Pencils" });
  });

  it("enforces RBAC and tenant isolation", async () => {
    const kit = (await listCatalogProducts(t.db, c)).products[0]!;
    await expect(listCatalogProducts(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();
    await expect(syncShopifyCatalog(t.db, { actorId: viewerId, websiteId: c.websiteId, secretKey: KEY, request: shopify })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveCatalogDraft(t.db, { ...other, productId: kit.id, title: "x", description: "y", faq: "", source: "t" })).rejects.toThrow(DomainError);
  });
});
