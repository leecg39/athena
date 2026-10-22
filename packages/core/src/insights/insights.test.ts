import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { responses, responseMentions, responseCitations, runs, insights, customRoles, orgMembers, websiteMembers, users } from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { createPrompt, createTopic } from "../prompts";
import { createCompetitor } from "../competitors";
import { citationRow } from "../sources";
import { ForbiddenError, NotFoundError } from "../org/errors";
import { generateInsights, listInsights, updateInsightStatus } from "./index";

describe("insights engine", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let orgId: string;
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };
  const NOW = new Date("2026-10-05T12:00:00Z");
  const at = (d: string) => new Date(`${d}T12:00:00Z`);

  beforeAll(async () => {
    t = await createTestDb();
    const u = await ensureUserWithOrg(t.db, { email: "insights@example.com" });
    orgId = u.organizationId;
    const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: u.user.id, websiteId: site.id };

    const figma = await createCompetitor(t.db, { ...c, name: "Figma", domain: "figma.com" });
    const canva = await createCompetitor(t.db, { ...c, name: "Canva", domain: "canva.com" });
    const topic = await createTopic(t.db, { ...c, name: "Design Collaboration" });
    const pA = await createPrompt(t.db, { ...c, text: "best collaborative design tool for teams", topicId: topic.id });
    const pB = await createPrompt(t.db, { ...c, text: "online mood board software", topicId: topic.id });
    const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();

    const mk = async (o: {
      prompt: string;
      model?: string;
      day: string;
      text: string;
      brand: number | null;
      cited?: boolean;
      figma?: number;
      canva?: number;
      urls: string[];
    }) => {
      const [r] = await t.db
        .insert(responses)
        .values({
          runId: run.id,
          websiteId: site.id,
          promptId: o.prompt,
          model: o.model ?? "chatgpt",
          rawText: o.text,
          ranAt: at(o.day),
          mentioned: o.brand !== null,
          position: o.brand,
          cited: o.cited ?? false,
        })
        .returning();
      if (o.brand !== null) {
        await t.db.insert(responseMentions).values({ responseId: r.id, name: "Canvasly", position: o.brand, sentiment: "positive" });
      }
      if (o.figma) {
        await t.db.insert(responseMentions).values({ responseId: r.id, competitorId: figma.id, name: "Figma", position: o.figma, sentiment: "positive" });
      }
      if (o.canva) {
        await t.db.insert(responseMentions).values({ responseId: r.id, competitorId: canva.id, name: "Canva", position: o.canva, sentiment: "neutral" });
      }
      if (o.urls.length) {
        await t.db.insert(responseCitations).values(o.urls.map((url, i) => ({ responseId: r.id, rank: i, ...citationRow(url, "canvasly.io") })));
      }
    };

    // Previous 30d window (2026-08-06 .. 2026-09-05): Canvasly mentioned in 100% (2/2), Figma in 50% (1/2)
    await mk({ prompt: pA.id, day: "2026-08-20", text: "1. Canvasly 2. Figma", brand: 1, figma: 2, cited: true, urls: ["https://canvasly.io/teams"] });
    await mk({ prompt: pB.id, day: "2026-08-22", text: "1. Canvasly", brand: 1, cited: true, urls: ["https://canvasly.io/moodboards"] });

    // Current 30d window (2026-09-05 .. 2026-10-05):
    // 4 responses total: Canvasly mentioned in 2/4 (50%), cited in 0/4 (0% -> 50pt uncited mention gap)
    // Figma mentioned in 4/4 (100% -> +50pt surge vs prev & leads Canvasly by 50pts)
    // pA has 2 lost answers where Figma + Canva are recommended without Canvasly
    // g2.com and reddit.com are cited alongside competitors more than Canvasly
    await mk({
      prompt: pA.id,
      day: "2026-09-20",
      text: "1. Figma 2. Canva",
      brand: null,
      figma: 1,
      canva: 2,
      urls: ["https://g2.com/categories/design", "https://reddit.com/r/design"],
    });
    await mk({
      prompt: pA.id,
      model: "perplexity",
      day: "2026-09-21",
      text: "1. Figma 2. Canva",
      brand: null,
      figma: 1,
      canva: 2,
      urls: ["https://g2.com/compare/figma-vs-canva", "https://reddit.com/r/uxdesign"],
    });
    await mk({
      prompt: pB.id,
      day: "2026-09-22",
      text: "1. Figma 2. Canvasly",
      brand: 2,
      figma: 1,
      urls: ["https://g2.com/categories/mood-board"],
    });
    await mk({
      prompt: pB.id,
      model: "gemini",
      day: "2026-09-25",
      text: "1. Figma 2. Canvasly",
      brand: 2,
      figma: 1,
      urls: ["https://figma.com/templates"],
    });

    // Read-only viewer in the same org (has prompts:read but not prompts:write)
    const [viewer] = await t.db.insert(users).values({ email: "viewer-insights@example.com", name: "Viewer" }).returning();
    const [role] = await t.db
      .insert(customRoles)
      .values({ organizationId: orgId, name: "Insights Viewer", permissions: ["websites:read", "prompts:read"] })
      .returning();
    await t.db.insert(orgMembers).values({ organizationId: orgId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;

    // Outsider in another org
    const o = await ensureUserWithOrg(t.db, { email: "insights-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
    outsider = { actorId: o.user.id, websiteId: oSite.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("returns 0 insights when a website has no collected responses", async () => {
    const res = await generateInsights(t.db, { ...outsider, now: NOW });
    expect(res).toEqual({ created: 0, updated: 0, skipped: 0, insights: [] });
  });

  it("generates data-backed opportunity, gap, and competitor_move insights with concrete numbers and action links", async () => {
    const res = await generateInsights(t.db, { ...c, now: NOW });
    expect(res.created).toBeGreaterThanOrEqual(5);
    expect(res.updated).toBe(0);

    const kinds = new Set(res.insights.map((i) => i.kind));
    expect(kinds.has("opportunity")).toBe(true);
    expect(kinds.has("gap")).toBe(true);
    expect(kinds.has("competitor_move")).toBe(true);

    // Every insight has a non-empty title, body with numbers, and structured action with signalKey + internal href
    for (const item of res.insights) {
      expect(item.status).toBe("active");
      expect(item.title.length).toBeGreaterThan(10);
      expect(item.body).toMatch(/\d+%/);
      expect(item.action.signalKey).toBeTruthy();
      expect(item.action.href).toMatch(/^\/[a-z]/);
      expect(item.action.askPrompt).toBeTruthy();
    }

    // Specific signals verified against seeded data:
    const byKey = new Map(res.insights.map((i) => [i.action.signalKey, i]));
    expect(byKey.get("opportunity:source:g2.com")?.body).toContain("g2.com");
    expect(byKey.get("opportunity:uncited-mentions")?.body).toContain("50%");
    const promptGap = [...byKey.values()].find((i) => i.action.signalKey?.startsWith("gap:prompt:"));
    expect(promptGap?.title).toContain("best collaborative design tool for teams");
    expect(promptGap?.body).toContain("Figma");
    const topicGap = [...byKey.values()].find((i) => i.action.signalKey?.startsWith("gap:topic:"));
    expect(topicGap?.title).toContain("Design Collaboration");
    const compMove = [...byKey.values()].find((i) => i.kind === "competitor_move" && i.title.includes("Figma"));
    expect(compMove).toBeTruthy();
  });

  it("is idempotent on re-run and updates active insights in place without duplicating rows", async () => {
    const before = await t.db.select().from(insights).where(eq(insights.websiteId, c.websiteId));
    const rerun = await generateInsights(t.db, { websiteId: c.websiteId, now: NOW }); // also tests background mode without actorId
    expect(rerun.created).toBe(0);
    expect(rerun.updated).toBe(before.length);
    const after = await t.db.select().from(insights).where(eq(insights.websiteId, c.websiteId));
    expect(after).toHaveLength(before.length);
  });

  it("serializes concurrent generateInsights calls without creating duplicate signalKey rows", async () => {
    await t.db.delete(insights).where(eq(insights.websiteId, c.websiteId));
    const [r1, r2] = await Promise.all([
      generateInsights(t.db, { ...c, now: NOW }),
      generateInsights(t.db, { ...c, now: NOW }),
    ]);
    const rows = await t.db.select().from(insights).where(eq(insights.websiteId, c.websiteId));
    const keys = rows.map((r) => (r.action as { signalKey?: string })?.signalKey);
    expect(new Set(keys).size).toBe(rows.length);
    expect(r1.created + r2.created).toBe(rows.length);
  });

  it("manages active / resolved / discarded status, filters by status & kind, and does not resurrect resolved/discarded insights", async () => {
    const all = await listInsights(t.db, c);
    expect(all.counts.active).toBeGreaterThanOrEqual(5);
    expect(all.counts.resolved).toBe(0);
    expect(all.counts.discarded).toBe(0);

    const first = all.rows[0]!;
    const second = all.rows[1]!;

    const resolved = await updateInsightStatus(t.db, { ...c, insightId: first.id, status: "resolved" });
    expect(resolved.status).toBe("resolved");

    const discarded = await updateInsightStatus(t.db, { ...c, insightId: second.id, status: "discarded" });
    expect(discarded.status).toBe("discarded");

    const activeView = await listInsights(t.db, { ...c, status: "active" });
    expect(activeView.counts).toEqual({
      active: all.counts.total - 2,
      resolved: 1,
      discarded: 1,
      total: all.counts.total,
    });
    expect(activeView.rows.map((r) => r.id)).not.toContain(first.id);
    expect(activeView.rows.map((r) => r.id)).not.toContain(second.id);

    const resolvedView = await listInsights(t.db, { ...c, status: "resolved" });
    expect(resolvedView.rows.map((r) => r.id)).toEqual([first.id]);

    const gapOnly = await listInsights(t.db, { ...c, status: "active", kind: "gap" });
    expect(gapOnly.rows.every((r) => r.kind === "gap")).toBe(true);

    // Re-running generateInsights must skip resolved & discarded signalKeys rather than recreating them
    const gen = await generateInsights(t.db, { ...c, now: NOW });
    expect(gen.created).toBe(0);
    expect(gen.skipped).toBe(2);

    // Reopening a resolved insight sets it back to active
    const reopened = await updateInsightStatus(t.db, { ...c, insightId: first.id, status: "active" });
    expect(reopened.status).toBe("active");
    await updateInsightStatus(t.db, { ...c, insightId: second.id, status: "active" });
  });

  it("auto-resolves stale active signal insights when the underlying signal disappears", async () => {
    const [stale] = await t.db
      .insert(insights)
      .values({
        websiteId: c.websiteId,
        title: "Stale competitor move",
        body: "Old competitor lead that is no longer present",
        kind: "competitor_move",
        status: "active",
        action: { signalKey: "competitor_move:lead:00000000-0000-4000-8000-000000000999", href: "/competitors" },
      })
      .returning();

    await generateInsights(t.db, { ...c, now: NOW });
    const [after] = await t.db.select().from(insights).where(eq(insights.id, stale.id));
    expect(after?.status).toBe("resolved");
    await t.db.delete(insights).where(eq(insights.id, stale.id));
  });

  it("enforces tenant isolation and RBAC permissions", async () => {
    const all = await listInsights(t.db, c);
    const targetId = all.rows[0]!.id;

    // Viewer can read, but cannot generate or mutate status
    await expect(listInsights(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();
    await expect(generateInsights(t.db, { actorId: viewerId, websiteId: c.websiteId, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateInsightStatus(t.db, { actorId: viewerId, websiteId: c.websiteId, insightId: targetId, status: "discarded" })).rejects.toBeInstanceOf(ForbiddenError);

    // Outsider cannot read, generate, or mutate
    await expect(listInsights(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(generateInsights(t.db, { actorId: outsider.actorId, websiteId: c.websiteId, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateInsightStatus(t.db, { actorId: outsider.actorId, websiteId: outsider.websiteId, insightId: targetId, status: "discarded" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
