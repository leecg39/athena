import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { users, orgMembers, websiteMembers, customRoles, prompts, responses, responseCitations, kbPillars, kbFacts, competitors, outreachOpportunities } from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError } from "../org/errors";
import {
  discoverOutreachOpportunities,
  listOutreachOpportunities,
  createOutreachOpportunity,
  getOutreachOpportunity,
  findOutreachAuthor,
  generateOutreachEmailDraft,
  outreachPitchContext,
  templatePitchEmail,
  saveOutreachEmailDraft,
  updateOutreachStatus,
  updateOutreachOpportunity,
  deleteOutreachOpportunity,
} from "./index";

const FORBES = "https://forbes.com/advisor/business/software/best-design-software";
const G2_CATEGORY = "https://g2.com/categories/ai-design-tools";

describe("outreach: discovery from real citations, author finder, pitch drafts and kanban", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "outreach-owner@example.com", name: "Outreach Owner" });
    const site = await createWebsite(t.db, { organizationId, userId: user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: user.id, websiteId: site.id };
    await t.db.insert(competitors).values({ websiteId: site.id, domain: "figma.com", name: "Figma" });

    const [p1] = await t.db.insert(prompts).values({ websiteId: site.id, text: "best ai design tools for product teams", type: "non_branded", volumeEstimate: 2400 }).returning();
    const [p2] = await t.db.insert(prompts).values({ websiteId: site.id, text: "figma alternatives", type: "non_branded", volumeEstimate: 800 }).returning();
    const answer = async (promptId: string, urls: string[]) => {
      const [r] = await t.db.insert(responses).values({ websiteId: site.id, promptId, model: "chatgpt", rawText: "1. Figma — popular choice.", mentioned: false, cited: false }).returning();
      if (urls.length) {
        await t.db.insert(responseCitations).values(urls.map((url, i) => ({ responseId: r.id, url, domain: new URL(url).hostname, rootDomain: new URL(url).hostname, normalizedUrl: url, rank: i, isBrand: false })));
      }
    };
    await answer(p1.id, [FORBES, G2_CATEGORY]);
    await answer(p1.id, [FORBES, FORBES]); // the same page twice in one answer counts once
    await answer(p2.id, [FORBES, "https://canvasly.io/blog/x"]);
    await answer(p2.id, ["https://g2.com/"]);

    const [viewer] = await t.db.insert(users).values({ email: "outreach-viewer@example.com", name: "Viewer" }).returning();
    const [role] = await t.db.insert(customRoles).values({ organizationId, name: "Outreach Reader", permissions: ["websites:read", "content:read"] }).returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;
    const o = await ensureUserWithOrg(t.db, { email: "outreach-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
    outsider = { actorId: o.user.id, websiteId: oSite.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("creates opportunities only from pages AI answers actually cite, with real rates", async () => {
    const [d1, d2] = await Promise.all([discoverOutreachOpportunities(t.db, c), discoverOutreachOpportunities(t.db, c)]);
    expect(d1.created + d2.created).toBe(3);
    const list = await listOutreachOpportunities(t.db, c);
    const byUrl = new Map(list.rows.map((r) => [r.url, r]));
    expect([...byUrl.keys()].sort()).toEqual([FORBES, "https://g2.com/", G2_CATEGORY].sort());
    // 3 of 4 answers cite the Forbes page; its prompts have 2,400 + 800 monthly searches
    expect(byUrl.get(FORBES)).toMatchObject({ citations: 3, citationPct: 75, estimatedImpressions: 3200 });
    expect(byUrl.get(G2_CATEGORY)).toMatchObject({ citations: 1, citationPct: 25, estimatedImpressions: 2400 });
    // a cited homepage stays a homepage (no invented article URLs)
    expect(byUrl.get("https://g2.com/")).toMatchObject({ citations: 1, estimatedImpressions: 800 });
  });

  it("validates manual additions and fills stats only from stored citations", async () => {
    await expect(createOutreachOpportunity(t.db, { ...c, url: "https://canvasly.io/blog/post" })).rejects.toBeInstanceOf(DomainError);
    await expect(createOutreachOpportunity(t.db, { ...c, url: "javascript:alert(1)" })).rejects.toBeInstanceOf(DomainError);
    await expect(createOutreachOpportunity(t.db, { ...c, url: "http://127.0.0.1:8080/internal" })).rejects.toBeInstanceOf(DomainError);
    const manual = await createOutreachOpportunity(t.db, { ...c, url: "https://smashingmagazine.com/2026/09/design-systems-tools", notes: "Design engineering roundup" });
    expect(manual).toMatchObject({ domain: "smashingmagazine.com", status: "new", citations: 0, citationPct: 0, estimatedImpressions: 0 });
    await expect(createOutreachOpportunity(t.db, { ...c, url: "https://smashingmagazine.com/2026/09/design-systems-tools/" })).rejects.toBeInstanceOf(DomainError);
  });

  it("finds authors only where the page publishes them, otherwise asks for manual entry", async () => {
    const forbes = (await listOutreachOpportunities(t.db, c)).rows.find((r) => r.url === FORBES)!;
    expect((await getOutreachOpportunity(t.db, { ...c, opportunityId: forbes.id })).url).toBe(FORBES);
    // nothing to read: no guessed "editorial@" address, no directory of made-up people
    await expect(findOutreachAuthor(t.db, { ...c, opportunityId: forbes.id, page: null })).rejects.toThrow(/could not be loaded/i);
    await expect(findOutreachAuthor(t.db, { ...c, opportunityId: forbes.id, page: { html: "<html><body>No byline</body></html>" } })).rejects.toThrow(/no author/i);
    expect((await getOutreachOpportunity(t.db, { ...c, opportunityId: forbes.id })).authorName).toBeNull();

    const html = `<script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"Dana Lee","email":"dana@forbes.example"}}</script>`;
    const found = await findOutreachAuthor(t.db, { ...c, opportunityId: forbes.id, page: { html } });
    expect(found).toMatchObject({ source: "json-ld", opportunity: { authorName: "Dana Lee", authorEmail: "dana@forbes.example" } });
    const manual = await findOutreachAuthor(t.db, { ...c, opportunityId: forbes.id, authorName: "Dana Lee", authorEmail: "dana.lee@forbes.example" });
    expect(manual).toMatchObject({ source: "manual", opportunity: { authorEmail: "dana.lee@forbes.example" } });
    await expect(findOutreachAuthor(t.db, { ...c, opportunityId: forbes.id, authorEmail: "not-an-email" })).rejects.toThrow(/email/i);
  });

  it("drafts pitches from verified data only and never invents brand claims", async () => {
    const g2 = (await listOutreachOpportunities(t.db, c)).rows.find((r) => r.url === G2_CATEGORY)!;
    const ctx = await outreachPitchContext(t.db, { ...c, opportunityId: g2.id });
    expect(ctx).toMatchObject({ brand: "Canvasly", brandDomain: "canvasly.io", facts: [], competitors: ["Figma"], opportunity: { citationPct: 25 } });
    const bare = templatePitchEmail(ctx, "");
    expect(bare).toContain("Hi there,");
    expect(bare).toContain("cited in 25% of the AI answers we track");
    expect(bare).toMatch(/\[Add 2-3 verified facts about Canvasly/);
    expect(bare).not.toMatch(/verified enterprise security|AI-native workflows|press sandbox/i);

    const [pillar] = await t.db.insert(kbPillars).values({ websiteId: c.websiteId, name: "Pricing", document: "# Pricing" }).returning();
    await t.db.insert(kbFacts).values({ websiteId: c.websiteId, pillarId: pillar.id, claim: "Canvasly Pro starts at $29 per month", status: "confirmed", confidence: "0.99" });
    const drafted = await generateOutreachEmailDraft(t.db, { ...c, opportunityId: g2.id, angle: "We just published 2026 benchmark data" });
    expect(drafted.emailDraft).toContain("- Canvasly Pro starts at $29 per month");
    expect(drafted.emailDraft).toContain("We just published 2026 benchmark data");
    expect(drafted).toMatchObject({ status: "todo", authorName: null, authorEmail: null });

    const saved = await saveOutreachEmailDraft(t.db, { ...c, opportunityId: g2.id, emailDraft: "Subject: Hello\n\nHi Dana, …" });
    expect(saved.emailDraft).toBe("Subject: Hello\n\nHi Dana, …");
    await expect(saveOutreachEmailDraft(t.db, { ...c, opportunityId: g2.id, emailDraft: "   " })).rejects.toBeInstanceOf(DomainError);
  });

  it("moves cards across the kanban and keeps work when discovery re-runs", async () => {
    const g2 = (await listOutreachOpportunities(t.db, c)).rows.find((r) => r.url === G2_CATEGORY)!;
    expect((await updateOutreachStatus(t.db, { ...c, opportunityId: g2.id, status: "done" })).status).toBe("done");
    expect((await updateOutreachOpportunity(t.db, { ...c, opportunityId: g2.id, notes: "Pitched on Oct 23" })).notes).toBe("Pitched on Oct 23");
    await discoverOutreachOpportunities(t.db, c);
    const kept = (await listOutreachOpportunities(t.db, { ...c, status: "done" })).rows.find((r) => r.id === g2.id)!;
    expect(kept).toMatchObject({ notes: "Pitched on Oct 23", emailDraft: "Subject: Hello\n\nHi Dana, …" });
    const temp = await createOutreachOpportunity(t.db, { ...c, url: "https://venturebeat.com/ai/design-tools-comparison" });
    await deleteOutreachOpportunity(t.db, { ...c, opportunityId: temp.id });
    expect((await t.db.select().from(outreachOpportunities).where(eq(outreachOpportunities.id, temp.id))).length).toBe(0);
  });

  it("enforces tenant isolation and RBAC", async () => {
    await expect(listOutreachOpportunities(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();
    await expect(discoverOutreachOpportunities(t.db, { actorId: viewerId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createOutreachOpportunity(t.db, { actorId: viewerId, websiteId: c.websiteId, url: "https://wired.com/story/ai" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOutreachOpportunities(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    const any = (await listOutreachOpportunities(t.db, c)).rows[0]!;
    await expect(getOutreachOpportunity(t.db, { ...outsider, opportunityId: any.id })).rejects.toThrow();
  });
});
