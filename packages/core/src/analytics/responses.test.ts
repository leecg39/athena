import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { responses, responseMentions, responseCitations, competitors, runs } from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { createPrompt, createTopic } from "../prompts";
import { ForbiddenError, NotFoundError } from "../org/errors";
import { listResponses, getResponseDetail, responseMatrix } from "./responses";

let t: TestDb;
let c: { actorId: string; websiteId: string };
let figma: string;
let ids: Record<string, string> = {};
let pA: { id: string };
let pB: { id: string };
const D = (s: string) => new Date(`${s}T12:00:00Z`);
const range = { from: D("2026-09-30"), to: D("2026-10-05") };

beforeAll(async () => {
  t = await createTestDb();
  const u = await ensureUserWithOrg(t.db, { email: "resp@example.com" });
  const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
  c = { actorId: u.user.id, websiteId: site.id };
  const topic = await createTopic(t.db, { ...c, name: "Tools" });
  pA = await createPrompt(t.db, { ...c, text: "best canvas apps", topicId: topic.id });
  pB = await createPrompt(t.db, { ...c, text: "how to prototype 100% faster" });
  [{ id: figma }] = await t.db.insert(competitors).values({ websiteId: site.id, name: "Figma", domain: "figma.com" }).returning();
  const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();
  const mk = async (key: string, v: { promptId: string; model: string; day: string; text: string; mentioned: boolean; cited: boolean; position?: number; comps?: string[]; cites?: string[] }) => {
    const [r] = await t.db
      .insert(responses)
      .values({ runId: run.id, websiteId: site.id, promptId: v.promptId, model: v.model, rawText: v.text, ranAt: D(v.day), mentioned: v.mentioned, cited: v.cited, position: v.position ?? null })
      .returning();
    ids[key] = r.id;
    if (v.mentioned) await t.db.insert(responseMentions).values({ responseId: r.id, name: "Canvasly", position: v.position ?? null });
    for (const cid of v.comps ?? []) await t.db.insert(responseMentions).values({ responseId: r.id, competitorId: cid, name: "Figma" });
    for (const [i, url] of (v.cites ?? []).entries()) {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      await t.db.insert(responseCitations).values({ responseId: r.id, url, domain, rank: i, isBrand: domain === "canvasly.io" });
    }
  };
  await mk("a1", { promptId: pA.id, model: "chatgpt", day: "2026-10-01", text: "Canvasly and Figma lead.", mentioned: true, cited: true, position: 1, comps: [figma], cites: ["https://canvasly.io/a", "https://www.g2.com/x"] });
  await mk("a2", { promptId: pA.id, model: "chatgpt", day: "2026-10-03", text: "Figma is the standard.", mentioned: false, cited: false, comps: [figma], cites: ["https://reddit.com/r/x"] });
  await mk("b1", { promptId: pB.id, model: "perplexity", day: "2026-10-02", text: "Use paper prototypes.", mentioned: false, cited: false });
});
afterAll(async () => {
  await t.close();
});

describe("listResponses", () => {
  it("lists newest first with prompt, sources and competitors", async () => {
    const r = await listResponses(t.db, { ...c, filters: range });
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.id)).toEqual([ids.a2, ids.b1, ids.a1]);
    const a1 = r.rows.find((x) => x.id === ids.a1)!;
    expect(a1).toMatchObject({ promptText: "best canvas apps", topicName: "Tools", model: "chatgpt", mentioned: true, cited: true, position: 1, sourcesCount: 2, competitors: ["Figma"] });
    expect(a1.topDomains).toEqual(["canvasly.io", "g2.com"]);
  });

  it("filters by mention, citation, competitor, model and safe search", async () => {
    const ids1 = async (f: Record<string, unknown>) => (await listResponses(t.db, { ...c, filters: { ...range, ...f } })).rows.map((x) => x.id).sort();
    expect(await ids1({ mentioned: false })).toEqual([ids.a2, ids.b1].sort());
    expect(await ids1({ cited: true })).toEqual([ids.a1]);
    expect(await ids1({ competitorId: figma })).toEqual([ids.a1, ids.a2].sort());
    expect(await ids1({ models: ["perplexity"] })).toEqual([ids.b1]);
    expect(await ids1({ q: "standard" })).toEqual([ids.a2]); // answer text
    expect(await ids1({ q: "100%" })).toEqual([ids.b1]); // prompt text, literal %
    expect(await ids1({ q: "%" })).toEqual([ids.b1]);
  });

  it("paginates", async () => {
    const p1 = await listResponses(t.db, { ...c, filters: range, limit: 2, offset: 0 });
    const p2 = await listResponses(t.db, { ...c, filters: range, limit: 2, offset: 2 });
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows.map((x) => x.id)).toEqual([ids.a1]);
    expect(p2.total).toBe(3);
  });
});

describe("responseMatrix", () => {
  it("shows the latest answer per prompt × model in the window", async () => {
    const m = await responseMatrix(t.db, { ...c, filters: range });
    expect(m.models).toEqual(["chatgpt", "perplexity"]);
    const rowA = m.rows.find((r) => r.promptId === pA.id)!;
    expect(rowA.cells.chatgpt).toMatchObject({ responseId: ids.a2, mentioned: false }); // 10-03 beats 10-01
    expect(rowA.cells.perplexity).toBeUndefined();
    expect(m.rows.find((r) => r.promptId === pB.id)!.cells.perplexity).toMatchObject({ responseId: ids.b1 });
  });
});

describe("getResponseDetail", () => {
  it("returns the answer with mentions, citations and prompt context", async () => {
    const d = await getResponseDetail(t.db, { ...c, responseId: ids.a1 });
    expect(d).toMatchObject({ id: ids.a1, rawText: "Canvasly and Figma lead.", promptText: "best canvas apps", model: "chatgpt" });
    expect(d.citations.map((x) => [x.domain, x.isBrand])).toEqual([["canvasly.io", true], ["g2.com", false]]);
    expect(d.mentions.map((m) => m.name).sort()).toEqual(["Canvasly", "Figma"]);
  });

  it("does not leak answers across websites or tenants", async () => {
    const other = await ensureUserWithOrg(t.db, { email: "resp-other@example.com" });
    const site2 = await createWebsite(t.db, { organizationId: other.organizationId, userId: other.user.id, domain: "other.io", name: "Other" });
    await expect(getResponseDetail(t.db, { actorId: other.user.id, websiteId: site2.id, responseId: ids.a1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getResponseDetail(t.db, { actorId: other.user.id, websiteId: c.websiteId, responseId: ids.a1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listResponses(t.db, { actorId: other.user.id, websiteId: c.websiteId, filters: range })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
