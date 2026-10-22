import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { responses, responseMentions, competitors, runs } from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { createPrompt } from "./prompts";
import { candidatesFromSearchConsole, competitorGapCandidates, mergeCandidates } from "./discover";
import { fetchGscTopQueries } from "../integrations";

describe("candidatesFromSearchConsole", () => {
  it("keeps conversational queries, ranks by impressions and skips tracked ones", () => {
    const out = candidatesFromSearchConsole(
      [
        { query: "canvasly", impressions: 9000, clicks: 900 },
        { query: "best ai design tool for startups", impressions: 1200, clicks: 30 },
        { query: "how do design tokens work", impressions: 3000, clicks: 50 },
        { query: "already tracked question here", impressions: 5000, clicks: 10 },
      ],
      new Set(["already tracked question here"]),
    );
    expect(out.map((c) => c.text)).toEqual(["how do design tokens work", "best ai design tool for startups"]);
    expect(out[0]).toMatchObject({ source: "search_console", volume: 3000 });
  });
});

describe("fetchGscTopQueries", () => {
  it("queries searchAnalytics for the property and maps rows", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Acanvasly.io/searchAnalytics/query");
      const body = JSON.parse(String(init?.body));
      expect(body.dimensions).toEqual(["query"]);
      return Response.json({ rows: [{ keys: ["how do design tokens work"], impressions: 3000, clicks: 50 }] });
    });
    const rows = await fetchGscTopQueries({ accessToken: "at", property: "sc-domain:canvasly.io", days: 28, fetchImpl, now: new Date("2026-10-22T00:00:00Z") });
    expect(rows).toEqual([{ query: "how do design tokens work", impressions: 3000, clicks: 50 }]);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.startDate).toBe("2026-09-24");
    expect(body.endDate).toBe("2026-10-21");
  });
});

describe("competitorGapCandidates", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("suggests prompts around competitors that appear where the brand does not", async () => {
    const u = await ensureUserWithOrg(t.db, { email: "gap@example.com" });
    const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
    const p = await createPrompt(t.db, { actorId: u.user.id, websiteId: site.id, text: "best design tools" });
    const [figma] = await t.db.insert(competitors).values({ websiteId: site.id, name: "Figma", domain: "figma.com" }).returning();
    const [canva] = await t.db.insert(competitors).values({ websiteId: site.id, name: "Canva", domain: "canva.com" }).returning();
    const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();
    const mk = async (mentioned: boolean, comps: { id: string; name: string }[]) => {
      const [r] = await t.db.insert(responses).values({ runId: run.id, promptId: p.id, websiteId: site.id, model: "chatgpt", rawText: "x", mentioned }).returning();
      if (comps.length) await t.db.insert(responseMentions).values(comps.map((c) => ({ responseId: r.id, competitorId: c.id, name: c.name })));
    };
    await mk(false, [figma, canva]);
    await mk(false, [figma]);
    await mk(true, [canva]); // brand present → not a gap
    const out = await competitorGapCandidates(t.db, { websiteId: site.id, brandName: "Canvasly", tracked: new Set(["best alternatives to canva"]) });
    expect(out[0]).toMatchObject({ source: "competitor_gap", volume: 2 });
    expect(out.map((c) => c.text)).toContain("Canvasly vs Figma");
    expect(out.map((c) => c.text)).toContain("best alternatives to Figma");
    expect(out.map((c) => c.text)).not.toContain("best alternatives to Canva"); // already tracked
  });
});

describe("mergeCandidates", () => {
  it("dedupes case-insensitively, keeping the highest-volume source", () => {
    const merged = mergeCandidates([
      [{ text: "Best AI tools", source: "site", volume: 0 }],
      [{ text: "best ai tools", source: "search_console", volume: 50 }],
    ]);
    expect(merged).toEqual([{ text: "best ai tools", source: "search_console", volume: 50 }]);
  });
});
