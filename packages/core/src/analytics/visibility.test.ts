import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { responses, responseMentions, competitors, runs, websites } from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { createPrompt, createTopic } from "../prompts";
import { ForbiddenError } from "../org/errors";
import { getVisibilityMetrics, getSearchValue, compareTotals } from "./visibility";
import { prompts } from "@athena/db";

let t: TestDb;
let c: { actorId: string; websiteId: string };
let figma: string;
let topicA: string;

const D = (s: string) => new Date(`${s}T12:00:00Z`);

beforeAll(async () => {
  t = await createTestDb();
  const u = await ensureUserWithOrg(t.db, { email: "metrics@example.com" });
  const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
  c = { actorId: u.user.id, websiteId: site.id };
  topicA = (await createTopic(t.db, { ...c, name: "A" })).id;
  const pA = await createPrompt(t.db, { ...c, text: "prompt in topic a", topicId: topicA });
  const pB = await createPrompt(t.db, { ...c, text: "prompt without topic" });
  [{ id: figma }] = await t.db.insert(competitors).values({ websiteId: site.id, name: "Figma", domain: "figma.com" }).returning();
  const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();
  // day 1: 2 responses (chatgpt): one mentions brand (pos 1) + figma, one only figma
  // day 2: 2 responses (perplexity): one brand cited (pos 3), one nothing
  const rows = [
    { promptId: pA.id, model: "chatgpt", ranAt: D("2026-10-01"), mentioned: true, cited: false, position: 1, comps: [figma] },
    { promptId: pB.id, model: "chatgpt", ranAt: D("2026-10-01"), mentioned: false, cited: false, position: null, comps: [figma] },
    { promptId: pA.id, model: "perplexity", ranAt: D("2026-10-02"), mentioned: true, cited: true, position: 3, comps: [] },
    { promptId: pB.id, model: "perplexity", ranAt: D("2026-10-02"), mentioned: false, cited: false, position: null, comps: [] },
  ];
  for (const r of rows) {
    const [saved] = await t.db
      .insert(responses)
      .values({ runId: run.id, websiteId: site.id, promptId: r.promptId, model: r.model, rawText: "x", ranAt: r.ranAt, mentioned: r.mentioned, cited: r.cited, position: r.position })
      .returning();
    if (r.mentioned) await t.db.insert(responseMentions).values({ responseId: saved.id, competitorId: null, name: "Canvasly" });
    for (const cid of r.comps) await t.db.insert(responseMentions).values({ responseId: saved.id, competitorId: cid, name: "Figma" });
  }
});
afterAll(async () => {
  await t.close();
});

describe("getVisibilityMetrics", () => {
  const range = { from: D("2026-09-30"), to: D("2026-10-03") };

  it("computes totals: mention rate, citation rate, avg position, share of voice", async () => {
    const m = await getVisibilityMetrics(t.db, { ...c, filters: range });
    expect(m.totals).toMatchObject({ responses: 4, mentionRate: 50, citationRate: 25, avgPosition: 2, shareOfVoice: 50 });
    expect(m.entities).toEqual([
      { competitorId: null, name: "Canvasly", mentions: 2, mentionRate: 50, shareOfVoice: 50 },
      { competitorId: figma, name: "Figma", mentions: 2, mentionRate: 50, shareOfVoice: 50 },
    ]);
  });

  it("returns a daily series and per-model breakdown", async () => {
    const m = await getVisibilityMetrics(t.db, { ...c, filters: range });
    expect(m.daily.map((d) => [d.date, d.responses, d.mentionRate, d.citationRate, d.shareOfVoice])).toEqual([
      ["2026-10-01", 2, 50, 0, 33.3],
      ["2026-10-02", 2, 50, 50, 100],
    ]);
    expect(m.byModel.map((b) => [b.model, b.mentionRate, b.avgPosition])).toEqual([
      ["chatgpt", 50, 1],
      ["perplexity", 50, 3],
    ]);
  });

  it("includes per-model and per-entity daily series for detailed charts", async () => {
    const m = await getVisibilityMetrics(t.db, { ...c, filters: range });
    expect(m.dailyByModel).toEqual([
      { date: "2026-10-01", model: "chatgpt", responses: 2, mentionRate: 50, citationRate: 0, avgPosition: 1 },
      { date: "2026-10-02", model: "perplexity", responses: 2, mentionRate: 50, citationRate: 50, avgPosition: 3 },
    ]);
    expect(m.dailyEntities.filter((e) => e.date === "2026-10-01").map((e) => [e.name, e.shareOfVoice])).toEqual([
      ["Canvasly", 33.3],
      ["Figma", 66.7],
    ]);
  });

  it("estimates AI-visible searches only from real volume data", async () => {
    expect(await getSearchValue(t.db, { ...c, filters: range })).toEqual({ hasVolume: false, aiVisibleSearches: 0, trackedVolume: 0 });
    // prompt A (volume 1000) is mentioned in 2/2 of its answers; prompt B (volume 500) in 0/2
    const [pa] = await t.db.select().from(prompts).where(eq(prompts.text, "prompt in topic a"));
    const [pb] = await t.db.select().from(prompts).where(eq(prompts.text, "prompt without topic"));
    await t.db.update(prompts).set({ volumeEstimate: 1000 }).where(eq(prompts.id, pa.id));
    await t.db.update(prompts).set({ volumeEstimate: 500 }).where(eq(prompts.id, pb.id));
    expect(await getSearchValue(t.db, { ...c, filters: range })).toEqual({ hasVolume: true, aiVisibleSearches: 1000, trackedVolume: 1500 });
  });

  it("compares two periods as point/percent deltas", () => {
    const d = compareTotals(
      { responses: 10, mentionRate: 40, citationRate: 10, avgPosition: 2.5, shareOfVoice: 30, simulatedShare: 0 },
      { responses: 8, mentionRate: 35, citationRate: 12, avgPosition: 3, shareOfVoice: 30, simulatedShare: 0 },
    );
    expect(d).toEqual({ mentionRate: 5, citationRate: -2, shareOfVoice: 0, avgPosition: -0.5 });
    expect(compareTotals({ responses: 3, mentionRate: 1, citationRate: 1, avgPosition: null, shareOfVoice: 1, simulatedShare: 0 }, { responses: 0, mentionRate: 0, citationRate: 0, avgPosition: null, shareOfVoice: 0, simulatedShare: 0 })).toBeNull();
  });

  it("applies model, topic and date filters", async () => {
    expect((await getVisibilityMetrics(t.db, { ...c, filters: { ...range, models: ["perplexity"] } })).totals.responses).toBe(2);
    expect((await getVisibilityMetrics(t.db, { ...c, filters: { ...range, topicIds: [topicA] } })).totals).toMatchObject({ responses: 2, mentionRate: 100 });
    expect((await getVisibilityMetrics(t.db, { ...c, filters: { from: D("2026-10-02"), to: D("2026-10-03") } })).totals.responses).toBe(2);
  });

  it("buckets days in the website's timezone", async () => {
    await t.db.update(websites).set({ timezone: "Asia/Seoul" }).where(eq(websites.id, c.websiteId));
    const m = await getVisibilityMetrics(t.db, { ...c, filters: range });
    expect(m.daily.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]); // 12:00Z = 21:00 KST, same day
    await t.db.update(websites).set({ timezone: "Pacific/Kiritimati" }).where(eq(websites.id, c.websiteId)); // UTC+14
    const m2 = await getVisibilityMetrics(t.db, { ...c, filters: range });
    expect(m2.daily.map((d) => d.date)).toEqual(["2026-10-02", "2026-10-03"]);
    await t.db.update(websites).set({ timezone: "UTC" }).where(eq(websites.id, c.websiteId));
  });

  it("returns zeros for an empty range and enforces access", async () => {
    const m = await getVisibilityMetrics(t.db, { ...c, filters: { from: D("2025-01-01"), to: D("2025-01-02") } });
    expect(m.totals).toMatchObject({ responses: 0, mentionRate: 0, citationRate: 0, avgPosition: null, shareOfVoice: 0 });
    const outsider = await ensureUserWithOrg(t.db, { email: "metrics-out@example.com" });
    await expect(getVisibilityMetrics(t.db, { actorId: outsider.user.id, websiteId: c.websiteId, filters: range })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
