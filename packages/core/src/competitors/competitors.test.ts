import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { responses, responseMentions, responseCitations, competitors, runs, attributes, attributeObservations } from "@athena/db";
import { and, eq, isNull } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { createPrompt, createTopic } from "../prompts";
import { citationRow } from "../sources";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import { createCompetitor, updateCompetitor, deleteCompetitor, compareEntities, topicHeatmap, discoverCompetitorCandidates, listItemTitles, MAX_COMPETITORS } from "./index";

describe("listItemTitles", () => {
  it("extracts product names from list items", () => {
    const text = "Top picks:\n1. **Sketch** — great for Mac\n2. Framer: interactive prototypes\n- Penpot (open source)\n* The best option overall is hard to say\n3. **Figma**";
    expect(listItemTitles(text)).toEqual(["Sketch", "Framer", "Penpot", "Figma"]);
  });
});

describe("competitors", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let orgId: string;
  const D = (s: string) => new Date(`${s}T12:00:00Z`);
  const range = { from: D("2026-09-30"), to: D("2026-10-04") };

  beforeAll(async () => {
    t = await createTestDb();
    const u = await ensureUserWithOrg(t.db, { email: "comp@example.com" });
    const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: u.user.id, websiteId: site.id };
    orgId = u.organizationId;
  });
  afterAll(async () => {
    await t.close();
  });

  it("creates, renames and deletes competitors with validation", async () => {
    const f = await createCompetitor(t.db, { ...c, name: "Figma", domain: "https://www.figma.com/pricing" });
    expect(f.domain).toBe("figma.com");
    await expect(createCompetitor(t.db, { ...c, name: "Figma again", domain: "figma.com" })).rejects.toBeInstanceOf(DomainError);
    await expect(createCompetitor(t.db, { ...c, name: "Self", domain: "canvasly.io" })).rejects.toBeInstanceOf(DomainError);
    const r = await updateCompetitor(t.db, { ...c, competitorId: f.id, name: "Figma Inc" });
    expect(r).toMatchObject({ changed: true, competitor: { name: "Figma Inc" } });
    // saving unchanged values writes nothing (and so triggers no re-analysis)
    expect(await updateCompetitor(t.db, { ...c, competitorId: f.id, name: "Figma Inc", domain: "figma.com" })).toMatchObject({ changed: false });
    await deleteCompetitor(t.db, { ...c, competitorId: f.id });
    const [row] = await t.db.select().from(competitors).where(eq(competitors.id, f.id));
    expect(row.deletedAt).not.toBeNull();
    // re-adding after delete works (partial unique index on live rows)
    await expect(createCompetitor(t.db, { ...c, name: "Figma", domain: "figma.com" })).resolves.toBeTruthy();
    const out = await ensureUserWithOrg(t.db, { email: "comp-out@example.com" });
    await expect(createCompetitor(t.db, { actorId: out.user.id, websiteId: c.websiteId, name: "X", domain: "x.com" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("caps live competitors per website and rejects the brand's own or duplicate names", async () => {
    const site = await createWebsite(t.db, { organizationId: orgId, userId: c.actorId, domain: "captest.io", name: "Captest" });
    const s = { actorId: c.actorId, websiteId: site.id };
    await expect(createCompetitor(t.db, { ...s, name: " captest ", domain: "other-brand.com" })).rejects.toThrow(/your own brand/);
    await createCompetitor(t.db, { ...s, name: "Alpha", domain: "alpha.com" });
    await expect(createCompetitor(t.db, { ...s, name: "ALPHA", domain: "alpha2.com" })).rejects.toThrow(/named Alpha is already tracked/);
    const beta = await createCompetitor(t.db, { ...s, name: "Beta", domain: "beta.com" });
    await expect(updateCompetitor(t.db, { ...s, competitorId: beta.id, name: "alpha" })).rejects.toThrow(/named Alpha is already tracked/);
    await expect(updateCompetitor(t.db, { ...s, competitorId: beta.id, name: "Beta Labs", domain: "beta.com" })).resolves.toMatchObject({ changed: true, competitor: { name: "Beta Labs" } });
    await t.db.insert(competitors).values(Array.from({ length: MAX_COMPETITORS - 2 }, (_, i) => ({ websiteId: site.id, name: `C${i}`, domain: `c${i}.com` })));
    await expect(createCompetitor(t.db, { ...s, name: "Over", domain: "over.com" })).rejects.toThrow(`at most ${MAX_COMPETITORS}`);
    await deleteCompetitor(t.db, { ...s, competitorId: beta.id });
    await expect(updateCompetitor(t.db, { ...s, competitorId: beta.id, name: "Beta 2" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createCompetitor(t.db, { ...s, name: "Over", domain: "over.com" })).resolves.toMatchObject({ domain: "over.com" });
  });

  it("keeps entities in creation order after edits", async () => {
    const site = await createWebsite(t.db, { organizationId: orgId, userId: c.actorId, domain: "ordertest.io", name: "Ordertest" });
    const s = { actorId: c.actorId, websiteId: site.id };
    // creation order differs from domain order (what an index scan would return)
    const zeta = await createCompetitor(t.db, { ...s, name: "Zeta", domain: "zeta.com" });
    await createCompetitor(t.db, { ...s, name: "Beta", domain: "beta.com" });
    await updateCompetitor(t.db, { ...s, competitorId: zeta.id, name: "Zeta Two" });
    const r = await compareEntities(t.db, { ...s, filters: range });
    expect(r.entities.map((e) => e.name)).toEqual(["Ordertest", "Zeta Two", "Beta"]);
    const h = await topicHeatmap(t.db, { ...s, filters: range });
    expect(h.entities.map((e) => e.name)).toEqual(["Ordertest", "Zeta Two", "Beta"]);
  });

  it("bounds discovery to the leading text of each answer", async () => {
    const site = await createWebsite(t.db, { organizationId: orgId, userId: c.actorId, domain: "scantest.io", name: "Scantest" });
    const s = { actorId: c.actorId, websiteId: site.id };
    const p = await createPrompt(t.db, { ...s, text: "long answers question" });
    const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();
    const filler = "Background paragraph about design tooling. ".repeat(400); // ~17k chars
    for (const text of [`1. **Lunacy**\n2. **Akira**\n${filler}`, `1. **Lunacy**\n2. **Akira**\n${filler}`, `${filler}\n1. **Vectornator**\n2. **Akira**`, `${filler}\n1. **Vectornator**\n2. **Akira**`]) {
      await t.db.insert(responses).values({ runId: run.id, websiteId: site.id, promptId: p.id, model: "chatgpt", rawText: text, ranAt: D("2026-10-01") });
    }
    const d = await discoverCompetitorCandidates(t.db, { ...s, filters: range });
    expect(d.map((x) => [x.name, x.responses])).toEqual([
      ["Akira", 2],
      ["Lunacy", 2],
    ]);
  });

  describe("analytics", () => {
    let figma: string;
    let topicA: string;
    beforeAll(async () => {
      [{ id: figma }] = await t.db.select({ id: competitors.id }).from(competitors).where(and(eq(competitors.domain, "figma.com"), isNull(competitors.deletedAt)));
      topicA = (await createTopic(t.db, { ...c, name: "Design" })).id;
      const pA = await createPrompt(t.db, { ...c, text: "best design tool", topicId: topicA });
      const pB = await createPrompt(t.db, { ...c, text: "untopiced question here" });
      const [run] = await t.db.insert(runs).values({ websiteId: c.websiteId, state: "completed" }).returning();
      const mk = async (promptId: string, brand: boolean, figmaMention: { position: number; sentiment: "positive" | "negative" } | null, urls: string[], text: string) => {
        const [r] = await t.db.insert(responses).values({ runId: run.id, websiteId: c.websiteId, promptId, model: "chatgpt", rawText: text, ranAt: D("2026-10-01"), mentioned: brand, position: brand ? 2 : null }).returning();
        if (brand) await t.db.insert(responseMentions).values({ responseId: r.id, name: "Canvasly", position: 2, sentiment: "positive" });
        if (figmaMention) await t.db.insert(responseMentions).values({ responseId: r.id, competitorId: figma, name: "Figma", position: figmaMention.position, sentiment: figmaMention.sentiment });
        if (urls.length) await t.db.insert(responseCitations).values(urls.map((u, i) => ({ responseId: r.id, rank: i, ...citationRow(u, "canvasly.io") })));
      };
      await mk(pA.id, true, { position: 1, sentiment: "positive" }, ["https://figma.com/blog"], "1. **Figma** — standard\n2. **Canvasly** — new\n3. **Sketch** — mac");
      await mk(pA.id, false, { position: 1, sentiment: "negative" }, [], "1. **Figma**\n2. **Sketch**\n3. **Penpot**");
      await mk(pB.id, true, null, ["https://canvasly.io/x"], "- Canvasly\n- Sketch\n- Penpot");
      await mk(pB.id, false, null, [], "No list here.");
    });

    it("compares brand and competitors", async () => {
      const r = await compareEntities(t.db, { ...c, filters: range });
      expect(r.totalResponses).toBe(4);
      const brand = r.entities.find((e) => e.competitorId === null)!;
      const fig = r.entities.find((e) => e.competitorId === figma)!;
      expect(brand).toMatchObject({ name: "Canvasly", mentionRate: 50, avgPosition: 2, citationRate: 25, sentiment: { positive: 2, neutral: 0, negative: 0, mixed: 0 } });
      expect(fig).toMatchObject({ mentionRate: 50, avgPosition: 1, citationRate: 25, sentiment: { positive: 1, negative: 1 } });
      expect(brand.shareOfVoice + fig.shareOfVoice).toBe(100);
    });

    it("builds a topic × entity heatmap for mention and citation rate", async () => {
      const h = await topicHeatmap(t.db, { ...c, filters: range });
      expect(h.topics.map((x) => x.name)).toEqual(["Design", "No topic"]);
      const iBrand = h.entities.findIndex((e) => e.competitorId === null);
      const iFig = h.entities.findIndex((e) => e.competitorId === figma);
      expect(h.mention[0][iBrand]).toBe(50);
      expect(h.mention[0][iFig]).toBe(100);
      expect(h.citation[0][iFig]).toBe(50);
      expect(h.citation[1][iBrand]).toBe(50);
    });

    it("discovers untracked brands from list items in answers", async () => {
      const d = await discoverCompetitorCandidates(t.db, { ...c, filters: range });
      expect(d.map((x) => [x.name, x.responses])).toEqual([
        ["Sketch", 3],
        ["Penpot", 2],
      ]);
    });

    it("drops a deleted competitor's mentions at once so share of voice stays consistent", async () => {
      const [attr] = await t.db.insert(attributes).values({ websiteId: c.websiteId, name: "price" }).returning();
      const [mention] = await t.db.select().from(responseMentions).where(eq(responseMentions.competitorId, figma)).limit(1);
      await t.db.insert(attributeObservations).values({ attributeId: attr.id, responseId: mention.responseId, competitorId: figma, textSpan: "Figma price", score: "0.80", positive: true });
      await deleteCompetitor(t.db, { ...c, competitorId: figma });
      expect(await t.db.select().from(responseMentions).where(eq(responseMentions.competitorId, figma))).toHaveLength(0);
      expect(await t.db.select().from(attributeObservations).where(eq(attributeObservations.competitorId, figma))).toHaveLength(0);
      const r = await compareEntities(t.db, { ...c, filters: range });
      expect(r.entities.map((e) => [e.name, e.shareOfVoice])).toEqual([["Canvasly", 100]]);
    });
  });
});
