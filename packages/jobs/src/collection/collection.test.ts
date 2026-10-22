import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { runs, runItems, responses, responseCitations, responseMentions, competitors, creditBalances, creditLedger, organizations, prompts, promptSchedules } from "@athena/db";
import { and, eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "@athena/core/tenancy";
import { createPrompt } from "@athena/core/prompts";
import { saveMonitoringSchedule } from "@athena/core/onboarding";
import { DomainError } from "@athena/core/org";
import type { SearchAdapter, CollectedAnswer } from "@athena/llm/providers";
import { planRun, executeRun, getRunProgress, dueSchedules, requeueStale, stalledRuns, cancelRun } from "./index";
import { createLocation, updatePrompt } from "@athena/core/prompts";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

function adapter(model: "chatgpt" | "perplexity", answer: (prompt: string) => CollectedAnswer | Error): SearchAdapter {
  return {
    model,
    label: model,
    collect: async (prompt) => {
      const a = answer(prompt);
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

const good = (model: string) => (prompt: string): CollectedAnswer => ({
  text: `For ${prompt}: Canvasly is the best choice. Figma is also popular. See https://www.g2.com/canvasly`,
  citations: [{ url: "https://canvasly.io/blog/x", title: "Canvasly blog" }],
  provider: `${model}:test`,
  tokensIn: 3,
  tokensOut: 9,
});

async function setup(email: string, prompts = 2) {
  const u = await ensureUserWithOrg(t.db, { email });
  const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
  await t.db.insert(competitors).values({ websiteId: site.id, name: "Figma", domain: "figma.com" });
  for (let i = 0; i < prompts; i++) await createPrompt(t.db, { actorId: u.user.id, websiteId: site.id, text: `best design tool question ${i}` });
  return { actorId: u.user.id, websiteId: site.id, orgId: u.organizationId };
}

const balance = async (orgId: string) => (await t.db.select().from(creditBalances).where(eq(creditBalances.organizationId, orgId)))[0].balance;

describe("planRun", () => {
  it("reserves prompts×models credits, creates items, and blocks overlapping runs", async () => {
    const c = await setup("run1@example.com");
    const adapters = [adapter("chatgpt", good("chatgpt")), adapter("perplexity", good("perplexity"))];
    const run = await planRun(t.db, { ...c, trigger: "manual", adapters });
    expect(run.totalResponses).toBe(4);
    expect(await balance(c.orgId)).toBe(300 - 4);
    expect(await t.db.select().from(runItems).where(eq(runItems.runId, run.id))).toHaveLength(4);
    await expect(planRun(t.db, { ...c, trigger: "manual", adapters })).rejects.toThrow(/already in progress/i);
  });

  it("refuses when credits are insufficient (and charges nothing)", async () => {
    const c = await setup("run2@example.com");
    await t.db.update(creditBalances).set({ balance: 1 }).where(eq(creditBalances.organizationId, c.orgId));
    await expect(planRun(t.db, { ...c, trigger: "manual", adapters: [adapter("chatgpt", good("chatgpt"))] })).rejects.toThrow(/not enough credits/i);
    expect(await balance(c.orgId)).toBe(1);
    expect(await t.db.select().from(runs).where(eq(runs.websiteId, c.websiteId))).toHaveLength(0);
  });

  it("only uses models the plan includes and that are configured", async () => {
    const c = await setup("run3@example.com");
    await expect(planRun(t.db, { ...c, trigger: "manual", adapters: [] })).rejects.toBeInstanceOf(DomainError);
    // free plan excludes Claude; a configured Claude adapter is not used
    const claude = { ...adapter("chatgpt", good("x")), model: "claude" } as unknown as SearchAdapter;
    await expect(planRun(t.db, { ...c, trigger: "manual", adapters: [claude] })).rejects.toThrow(/no ai models/i);
  });
});

describe("executeRun", () => {
  it("stores responses with extraction, refunds failed items once, and completes", async () => {
    const c = await setup("run4@example.com");
    const adapters = [adapter("chatgpt", good("chatgpt")), adapter("perplexity", () => new Error("upstream 503"))];
    const run = await planRun(t.db, { ...c, trigger: "manual", adapters });
    await executeRun(t.db, run.id, { adapters });
    const progress = await getRunProgress(t.db, run.id);
    expect(progress).toMatchObject({ state: "completed", total: 4, succeeded: 2, failed: 2, pending: 0, percent: 100 });
    const rows = await t.db.select().from(responses).where(eq(responses.runId, run.id));
    expect(rows).toHaveLength(2); // failures are NOT stored as fake responses
    expect(rows.every((r) => r.mentioned && r.cited && r.position === 1 && r.provider === "chatgpt:test")).toBe(true);
    const cites = await t.db.select().from(responseCitations).where(eq(responseCitations.responseId, rows[0].id));
    expect(cites.map((x) => x.domain).sort()).toEqual(["canvasly.io", "g2.com"]);
    const mentions = await t.db.select().from(responseMentions).where(eq(responseMentions.responseId, rows[0].id));
    expect(mentions.map((m) => m.name).sort()).toEqual(["Canvasly", "Figma"]);
    expect(await balance(c.orgId)).toBe(300 - 4 + 2);
    // re-running is idempotent: no duplicate responses, no double refund
    await executeRun(t.db, run.id, { adapters });
    expect(await t.db.select().from(responses).where(eq(responses.runId, run.id))).toHaveLength(2);
    expect(await balance(c.orgId)).toBe(298);
    const refunds = await t.db.select().from(creditLedger).where(and(eq(creditLedger.runId, run.id), eq(creditLedger.kind, "refund")));
    expect(refunds).toHaveLength(1);
  });

  it("resumes after a crash by requeueing stale running items", async () => {
    const c = await setup("run5@example.com", 1);
    const adapters = [adapter("chatgpt", good("chatgpt"))];
    const run = await planRun(t.db, { ...c, trigger: "manual", adapters });
    await t.db.update(runItems).set({ status: "running", updatedAt: new Date(Date.now() - 3_600_000) }).where(eq(runItems.runId, run.id));
    expect(await requeueStale(t.db, run.id, 15 * 60_000)).toBe(1);
    await executeRun(t.db, run.id, { adapters });
    expect((await getRunProgress(t.db, run.id)).succeeded).toBe(1);
  });
});

describe("recovery and cancellation", () => {
  it("finds runs with no progress for a while so the dispatcher can resume them", async () => {
    const c = await setup("run7@example.com", 1);
    const adapters = [adapter("chatgpt", good("chatgpt"))];
    const run = await planRun(t.db, { ...c, trigger: "manual", adapters });
    expect((await stalledRuns(t.db, 15 * 60_000)).map((r) => r.id)).not.toContain(run.id);
    const later = new Date(Date.now() + 30 * 60_000);
    expect((await stalledRuns(t.db, 15 * 60_000, later)).map((r) => r.id)).toContain(run.id);
    await executeRun(t.db, run.id, { adapters });
    expect((await stalledRuns(t.db, 15 * 60_000, later)).map((r) => r.id)).not.toContain(run.id);
  });

  it("cancels a run, refunding every unprocessed item", async () => {
    const c = await setup("run8@example.com", 3);
    const adapters = [adapter("chatgpt", good("chatgpt"))];
    const run = await planRun(t.db, { ...c, trigger: "manual", adapters });
    await executeRun(t.db, run.id, { adapters, maxItems: 1 });
    await cancelRun(t.db, { actorId: c.actorId, runId: run.id });
    const p = await getRunProgress(t.db, run.id);
    expect(p.state).toBe("cancelled");
    expect(p.succeeded).toBe(1);
    expect(await balance(c.orgId)).toBe(300 - 1);
    await expect(cancelRun(t.db, { actorId: c.actorId, runId: run.id })).rejects.toBeInstanceOf(DomainError);
    // a new run is allowed after cancellation
    await expect(planRun(t.db, { ...c, trigger: "manual", adapters })).resolves.toBeTruthy();
  });

  it("asks providers for the prompt's location country, and caps stored text", async () => {
    const c = await setup("run9@example.com", 1);
    const loc = await createLocation(t.db, { ...c, name: "Seoul", country: "KR" });
    const [p] = await t.db.select().from(prompts).where(eq(prompts.websiteId, c.websiteId));
    await updatePrompt(t.db, { ...c, promptId: p.id, locationId: loc.id });
    const seen: (string | undefined)[] = [];
    const a: SearchAdapter = { model: "chatgpt", label: "x", collect: async (_q, o) => (seen.push(o?.country), { text: "x".repeat(200_000), citations: [], provider: "t", tokensIn: 0, tokensOut: 0 }) };
    const run = await planRun(t.db, { ...c, trigger: "manual", adapters: [a] });
    await executeRun(t.db, run.id, { adapters: [a] });
    expect(seen).toEqual(["KR"]);
    const [r] = await t.db.select().from(responses).where(eq(responses.runId, run.id));
    expect(r.rawText.length).toBeLessThanOrEqual(100_000);
  });
});

describe("dueSchedules", () => {
  it("finds schedules whose cadence elapsed since their last run", async () => {
    const c = await setup("run6@example.com", 1);
    const schedule = await saveMonitoringSchedule(t.db, { ...c, cadence: "daily" });
    const now = new Date();
    expect((await dueSchedules(t.db, now)).map((s) => s.id)).toContain(schedule.id);
    await t.db.insert(runs).values({ websiteId: c.websiteId, scheduleId: schedule.id, state: "completed", trigger: "schedule", createdAt: new Date(now.getTime() - 3_600_000) });
    expect((await dueSchedules(t.db, now)).map((s) => s.id)).not.toContain(schedule.id);
    expect((await dueSchedules(t.db, new Date(now.getTime() + 24 * 3_600_000))).map((s) => s.id)).toContain(schedule.id);
    // deleted organisations / archived schedules are never due
    await t.db.update(promptSchedules).set({ archivedAt: new Date() }).where(eq(promptSchedules.id, schedule.id));
    expect((await dueSchedules(t.db, new Date(now.getTime() + 48 * 3_600_000))).map((s) => s.id)).not.toContain(schedule.id);
    void organizations;
    void prompts;
  });
});
