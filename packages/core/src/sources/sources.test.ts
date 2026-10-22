import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { responses, responseMentions, responseCitations, competitors, runs } from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { createPrompt } from "../prompts";
import { ForbiddenError } from "../org/errors";
import {
  normalizeUrl,
  rootDomainOf,
  classifySource,
  listSources,
  sourceDetail,
  urlInspector,
  sourceSankey,
  setSourceOverride,
  removeSourceOverride,
  citationRow,
} from "./index";

describe("url helpers", () => {
  it("normalises URLs for page grouping", () => {
    expect(normalizeUrl("HTTPS://WWW.Example.com/Path/?utm_source=x&b=2&a=1#frag")).toBe("https://example.com/Path?a=1&b=2");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/a/?gclid=1&fbclid=2&ref=tw")).toBe("https://example.com/a");
    expect(normalizeUrl("not a url")).toBeNull();
  });
  it("computes registrable domains, keeping private suffixes separate", () => {
    expect(rootDomainOf("https://www.bbc.co.uk/news")).toBe("bbc.co.uk");
    expect(rootDomainOf("https://blog.canva.com/x")).toBe("canva.com");
    expect(rootDomainOf("https://someone.github.io/post")).toBe("someone.github.io");
    expect(rootDomainOf("http://10.0.0.1/x")).toBe("10.0.0.1");
  });
  it("classifies owned / competitor / partner / third_party with overrides", () => {
    const ctx = {
      websiteDomain: "canvasly.io",
      competitorDomains: ["figma.com"],
      overrides: [
        { pattern: "reddit.com/user/canvasly", type: "owned" as const },
        { pattern: "partnerblog.com", type: "partner" as const },
        { pattern: "help.figma.com", type: "third_party" as const },
      ],
    };
    expect(classifySource("https://docs.canvasly.io/a", ctx)).toBe("owned");
    expect(classifySource("https://www.reddit.com/user/canvasly/comments/1", ctx)).toBe("owned");
    expect(classifySource("https://www.reddit.com/r/design", ctx)).toBe("third_party");
    expect(classifySource("https://figma.com/blog", ctx)).toBe("competitor");
    expect(classifySource("https://help.figma.com/x", ctx)).toBe("third_party");
    expect(classifySource("https://news.partnerblog.com/x", ctx)).toBe("partner");
  });
  it("builds citation rows with derived columns", () => {
    expect(citationRow("https://www.blog.canva.com/x?utm_medium=y", "canvasly.io")).toMatchObject({ domain: "blog.canva.com", rootDomain: "canva.com", normalizedUrl: "https://blog.canva.com/x", isBrand: false });
  });
});

describe("source analytics", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let figma: string;
  const D = (s: string) => new Date(`${s}T12:00:00Z`);
  const range = { from: D("2026-09-30"), to: D("2026-10-04") };

  beforeAll(async () => {
    t = await createTestDb();
    const u = await ensureUserWithOrg(t.db, { email: "src@example.com" });
    const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: u.user.id, websiteId: site.id };
    const p = await createPrompt(t.db, { ...c, text: "best canvas tools" });
    [{ id: figma }] = await t.db.insert(competitors).values({ websiteId: site.id, name: "Figma", domain: "figma.com" }).returning();
    const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();
    const mk = async (day: string, model: string, mentioned: boolean, compMention: boolean, urls: string[]) => {
      const [r] = await t.db.insert(responses).values({ runId: run.id, websiteId: site.id, promptId: p.id, model, rawText: "x", ranAt: D(day), mentioned }).returning();
      if (mentioned) await t.db.insert(responseMentions).values({ responseId: r.id, name: "Canvasly" });
      if (compMention) await t.db.insert(responseMentions).values({ responseId: r.id, competitorId: figma, name: "Figma" });
      if (urls.length) await t.db.insert(responseCitations).values(urls.map((u, i) => ({ responseId: r.id, rank: i, ...citationRow(u, "canvasly.io") })));
    };
    // 4 answers: reddit cited in 3 (brand mentioned in 2 of them), canvasly.io cited once, figma.com once
    await mk("2026-10-01", "chatgpt", true, true, ["https://www.reddit.com/r/design/1?utm_source=x", "https://canvasly.io/blog/a"]);
    await mk("2026-10-01", "perplexity", false, true, ["https://reddit.com/r/design/1", "https://figma.com/blog"]);
    await mk("2026-10-02", "chatgpt", true, false, ["https://old.reddit.com/r/ux/2"]);
    await mk("2026-10-02", "chatgpt", false, false, []);
  });
  afterAll(async () => {
    await t.close();
  });

  it("ranks root domains with citation %, brand/competitor mention %, types and sparkline", async () => {
    const r = await listSources(t.db, { ...c, filters: range });
    expect(r.days).toEqual(["2026-10-01", "2026-10-02"]);
    const reddit = r.rows[0];
    expect(reddit).toMatchObject({ rootDomain: "reddit.com", type: "third_party", responses: 3, citationPct: 75, brandMentionPct: 66.7, competitorMentionPct: 66.7, firstSeen: "2026-10-01" });
    expect(reddit.spark).toEqual([100, 50]);
    expect(r.rows.find((x) => x.rootDomain === "canvasly.io")?.type).toBe("owned");
    expect(r.rows.find((x) => x.rootDomain === "figma.com")?.type).toBe("competitor");
    expect((await listSources(t.db, { ...c, filters: range, type: "owned" })).rows.map((x) => x.rootDomain)).toEqual(["canvasly.io"]);
    expect((await listSources(t.db, { ...c, filters: { ...range, models: ["perplexity"] } })).rows.map((x) => x.rootDomain).sort()).toEqual(["figma.com", "reddit.com"]);
  });

  it("applies and removes source-type overrides", async () => {
    await setSourceOverride(t.db, { ...c, pattern: "reddit.com", type: "partner" });
    expect((await listSources(t.db, { ...c, filters: range })).rows[0].type).toBe("partner");
    await removeSourceOverride(t.db, { ...c, pattern: "reddit.com" });
    expect((await listSources(t.db, { ...c, filters: range })).rows[0].type).toBe("third_party");
    await expect(setSourceOverride(t.db, { ...c, pattern: "javascript:alert(1)", type: "owned" })).rejects.toThrow();
  });

  it("drills into a domain: pages, prompts, trend and competitors", async () => {
    const d = await sourceDetail(t.db, { ...c, rootDomain: "reddit.com", filters: range });
    expect(d.pages.map((p) => [p.url, p.responses])).toEqual([
      ["https://reddit.com/r/design/1", 2],
      ["https://old.reddit.com/r/ux/2", 1],
    ]);
    expect(d.prompts).toEqual([{ promptId: expect.any(String), text: "best canvas tools", responses: 3 }]);
    expect(d.trend.map((x) => [x.date, x.citationPct])).toEqual([
      ["2026-10-01", 100],
      ["2026-10-02", 50],
    ]);
    expect(d.competitors).toEqual([{ competitorId: figma, name: "Figma", responses: 2 }]);
    expect(d.responses).toHaveLength(3);
  });

  it("inspects a single URL across variants and models", async () => {
    const u = await urlInspector(t.db, { ...c, url: "https://www.reddit.com/r/design/1/", filters: range });
    expect(u.normalizedUrl).toBe("https://reddit.com/r/design/1");
    expect(u.totalResponses).toBe(2);
    expect(u.byModel).toEqual([
      { model: "chatgpt", responses: 1 },
      { model: "perplexity", responses: 1 },
    ]);
    expect(u.variants.sort()).toEqual(["https://reddit.com/r/design/1", "https://www.reddit.com/r/design/1?utm_source=x"]);
  });

  it("builds Sankey links from sources to the brands mentioned alongside them", async () => {
    const s = await sourceSankey(t.db, { ...c, filters: range, limit: 5 });
    const link = (from: string, to: string) => s.links.find((l) => s.nodes[l.source].name === from && s.nodes[l.target].name === to)?.value;
    expect(link("reddit.com", "Canvasly")).toBe(2);
    expect(link("reddit.com", "Figma")).toBe(2);
    expect(link("figma.com", "Figma")).toBe(1);
  });

  it("enforces access", async () => {
    const out = await ensureUserWithOrg(t.db, { email: "src-out@example.com" });
    await expect(listSources(t.db, { actorId: out.user.id, websiteId: c.websiteId, filters: range })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
