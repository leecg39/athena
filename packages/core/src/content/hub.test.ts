import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { users, orgMembers, websiteMembers, customRoles, kbPillars, kbFacts, prompts, competitors, contentItems, contentBriefs, contentVersions, responses, responseCitations } from "@athena/db";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError } from "../org/errors";
import {
  listContentHub,
  createContentItem,
  importContentFromUrl,
  updateContentItem,
  deleteContentItem,
  contentWritingContext,
  generateContentBrief,
  approveContentBrief,
  generateContentDraft,
  reviseWithAthena,
  saveContentVersion,
  MAX_CONTENT_ITEMS,
} from "./index";

const PAGE = `<html><head><title>Security | Canvasly</title></head><body><nav>Menu</nav><main><h1>Security at Canvasly</h1><p>All data is encrypted at rest.</p></main></body></html>`;

describe("content hub and writing pipeline", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "content-owner@example.com", name: "Content Owner" });
    const site = await createWebsite(t.db, { organizationId, userId: user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: user.id, websiteId: site.id };
    const [pillar] = await t.db.insert(kbPillars).values({ websiteId: site.id, name: "Pricing", document: "# Pricing" }).returning();
    await t.db.insert(kbFacts).values({ websiteId: site.id, pillarId: pillar.id, claim: "Canvasly Pro costs $29 per month", status: "confirmed", confidence: "0.99" });
    await t.db.insert(kbFacts).values({ websiteId: site.id, pillarId: pillar.id, claim: "Unreviewed claim", status: "pending_review", confidence: "0.5" });
    await t.db.insert(competitors).values({ websiteId: site.id, domain: "figma.com", name: "Figma" });
    const [p] = await t.db.insert(prompts).values({ websiteId: site.id, text: "best ai design tools", type: "non_branded" }).returning();
    const [r] = await t.db.insert(responses).values({ websiteId: site.id, promptId: p.id, model: "chatgpt", rawText: "See canvasly.io/security" }).returning();
    await t.db.insert(responseCitations).values({ responseId: r.id, url: "https://canvasly.io/security", domain: "canvasly.io", rank: 0, isBrand: true });

    const [viewer] = await t.db.insert(users).values({ email: "content-viewer@example.com", name: "Viewer" }).returning();
    const [role] = await t.db.insert(customRoles).values({ organizationId, name: "Content Reader", permissions: ["websites:read", "content:read"] }).returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;
    const o = await ensureUserWithOrg(t.db, { email: "content-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
    outsider = { actorId: o.user.id, websiteId: oSite.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("starts empty, never invents URLs and counts only real citations", async () => {
    expect((await listContentHub(t.db, c)).items).toEqual([]);
    const idea = await createContentItem(t.db, { ...c, title: "AI design tools guide" });
    expect(idea.targetUrl).toBeNull();
    await t.db.update(contentItems).set({ columns: { citationsSeed: 14 } }).where(eq(contentItems.id, idea.id));
    const listed = (await listContentHub(t.db, c)).items.find((i) => i.id === idea.id)!;
    expect(listed.citations30d).toBe(0);
    await expect(createContentItem(t.db, { ...c, title: "ai design tools guide" })).rejects.toBeInstanceOf(DomainError);
    expect((await updateContentItem(t.db, { ...c, contentId: idea.id, title: "AI design tools: a 2026 guide" })).title).toBe("AI design tools: a 2026 guide");
  });

  it("imports the real text of the brand's own pages", async () => {
    await expect(importContentFromUrl(t.db, { ...c, url: "https://figma.com/blog", page: { html: PAGE } })).rejects.toThrow(/own site/);
    await expect(importContentFromUrl(t.db, { ...c, url: "https://canvasly.io/security", page: null })).rejects.toThrow(/could not be loaded/);
    const item = await importContentFromUrl(t.db, { ...c, url: "https://canvasly.io/security", page: { html: PAGE } });
    expect(item).toMatchObject({ title: "Security at Canvasly", status: "draft", targetUrl: "https://canvasly.io/security" });
    const [v1] = await t.db.select().from(contentVersions).where(eq(contentVersions.contentId, item.id));
    expect(v1).toMatchObject({ version: 1, body: "# Security at Canvasly\n\nAll data is encrypted at rest." });
    expect(await t.db.select().from(contentBriefs).where(eq(contentBriefs.contentId, item.id))).toHaveLength(0);
    expect((await listContentHub(t.db, c)).items.find((i) => i.id === item.id)!.citations30d).toBe(1);
  });

  it("writes briefs and drafts from confirmed facts only and never approves on its own", async () => {
    const item = (await listContentHub(t.db, c)).items.find((i) => i.title.startsWith("AI design tools"))!;
    const ctx = await contentWritingContext(t.db, { ...c, contentId: item.id });
    expect(ctx.grounding.facts).toEqual(["Canvasly Pro costs $29 per month"]);
    expect(ctx.grounding.competitorNames).toEqual(["Figma"]);

    const brief = await generateContentBrief(t.db, { ...c, contentId: item.id });
    expect(brief.body).toContain("- Canvasly Pro costs $29 per month");
    expect(brief.body).not.toContain("Unreviewed claim");
    const { version } = await generateContentDraft(t.db, { ...c, contentId: item.id });
    expect(version.version).toBe(1);
    const [stored] = await t.db.select().from(contentBriefs).where(eq(contentBriefs.id, brief.id));
    expect(stored.approvedAt).toBeNull();
    expect((await approveContentBrief(t.db, { ...c, contentId: item.id, briefId: brief.id })).approvedAt).not.toBeNull();

    const aiDraft = await generateContentDraft(t.db, { ...c, contentId: item.id, body: "# AI draft\n\nWritten by a model from the brief.", source: "anthropic" });
    expect(aiDraft.version).toMatchObject({ version: 2, body: "# AI draft\n\nWritten by a model from the brief." });
  });

  it("stores AI revisions only when a writer produced text", async () => {
    const item = (await listContentHub(t.db, c)).items.find((i) => i.title.startsWith("AI design tools"))!;
    await expect(reviseWithAthena(t.db, { ...c, contentId: item.id, instruction: "Tighten" })).rejects.toThrow(/AI provider/);
    const revised = await reviseWithAthena(t.db, { ...c, contentId: item.id, instruction: "Tighten", body: "# Tighter draft\n\nShorter and clearer.", source: "anthropic" });
    expect(revised).toMatchObject({ status: "review", version: { version: 3 } });
    expect((await saveContentVersion(t.db, { ...c, contentId: item.id, body: "# Manual edit\n\nBy a person." })).version).toBe(4);
  });

  it("keeps system-managed columns and the published state out of manual edits", async () => {
    const item = await createContentItem(t.db, { ...c, title: "Managed columns check" });
    await expect(updateContentItem(t.db, { ...c, contentId: item.id, columns: { remoteId: "123" } })).rejects.toThrow(/managed by Athenum/);
    await expect(updateContentItem(t.db, { ...c, contentId: item.id, columns: { verifiedLiveAt: "2026-01-01" } })).rejects.toThrow(/managed by Athenum/);
    await expect(updateContentItem(t.db, { ...c, contentId: item.id, columns: { shopifyProductId: "1" } })).rejects.toThrow(/managed by Athenum/);
    await expect(updateContentItem(t.db, { ...c, contentId: item.id, status: "published" })).rejects.toThrow(/Publish/);
    const ok = await updateContentItem(t.db, { ...c, contentId: item.id, status: "review", columns: { persona: "CTO", region: "EU" } });
    expect(ok.columns).toMatchObject({ persona: "CTO", region: "EU" });
    await deleteContentItem(t.db, { ...c, contentId: item.id });
  });

  it("does not count Shopify catalog products against the content item limit", async () => {
    const o = await ensureUserWithOrg(t.db, { email: "content-limit@example.com" });
    const site = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "limit.io", name: "Limit" });
    const lc = { actorId: o.user.id, websiteId: site.id };
    await t.db.insert(contentItems).values(Array.from({ length: MAX_CONTENT_ITEMS }, (_, i) => ({ websiteId: site.id, title: `Product ${i}`, status: "idea" as const, columns: { catalogProduct: true, shopifyProductId: String(i + 1) } })));
    await expect(createContentItem(t.db, { ...lc, title: "First article" })).resolves.toBeTruthy();
    await t.db.insert(contentItems).values(Array.from({ length: MAX_CONTENT_ITEMS - 1 }, (_, i) => ({ websiteId: site.id, title: `Article ${i}`, status: "idea" as const })));
    await expect(createContentItem(t.db, { ...lc, title: "One too many" })).rejects.toThrow(/at most/);
  });

  it("enforces RBAC and tenant isolation", async () => {
    const item = (await listContentHub(t.db, c)).items[0]!;
    await expect(listContentHub(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();
    await expect(createContentItem(t.db, { actorId: viewerId, websiteId: c.websiteId, title: "Viewer blocked" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentWritingContext(t.db, { actorId: viewerId, websiteId: c.websiteId, contentId: item.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listContentHub(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteContentItem(t.db, { ...outsider, contentId: item.id })).rejects.toThrow();
    await deleteContentItem(t.db, { ...c, contentId: item.id });
  });
});
