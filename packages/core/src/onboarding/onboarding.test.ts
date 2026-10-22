import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { competitors, prompts, topics, personas, locations, promptSchedules, websites } from "@athena/db";
import { and, eq, isNull } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy/index";
import { createInvite, acceptInvite, ForbiddenError } from "../org/index";
import { MAX_COMPETITORS } from "../competitors";
import {
  saveBrandProfile,
  addCompetitors,
  addTrackedPrompts,
  saveAudience,
  saveMonitoringSchedule,
  completeOnboarding,
  templatePrompts,
  PROMPT_LIMITS,
} from "./index";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

async function setup(email: string) {
  const u = await ensureUserWithOrg(t.db, { email });
  const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: `${email.split("@")[0]}.io`, name: "Canvasly" });
  return { userId: u.user.id, orgId: u.organizationId, site };
}

describe("onboarding persistence", () => {
  it("saves the brand profile and advances the step", async () => {
    const { userId, site } = await setup("ob1@example.com");
    const w = await saveBrandProfile(t.db, { actorId: userId, websiteId: site.id, name: "Canvasly AI", description: "Design canvas", products: ["Canvas", " Tokens ", ""] });
    expect(w.name).toBe("Canvasly AI");
    expect(w.profile?.description).toBe("Design canvas");
    expect(w.profile?.products).toEqual(["Canvas", "Tokens"]);
    expect(w.onboardingStep).toBeGreaterThanOrEqual(1);
  });

  it("adds competitors with normalised, de-duplicated domains and never the brand itself", async () => {
    const { userId, site } = await setup("ob2@example.com");
    const added = await addCompetitors(t.db, {
      actorId: userId,
      websiteId: site.id,
      competitors: [
        { name: "Figma", domain: "https://www.figma.com/pricing" },
        { name: "Figma dup", domain: "FIGMA.com" },
        { name: "Self", domain: site.domain },
        { name: "Canva", domain: "canva.com" },
      ],
    });
    expect(added.map((c) => c.domain).sort()).toEqual(["canva.com", "figma.com"]);
    // idempotent on re-submit
    await addCompetitors(t.db, { actorId: userId, websiteId: site.id, competitors: [{ name: "Figma", domain: "figma.com" }] });
    const rows = await t.db.select().from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt)));
    expect(rows).toHaveLength(2);
    await expect(addCompetitors(t.db, { actorId: userId, websiteId: site.id, competitors: [{ name: "x", domain: "not a domain" }] })).rejects.toThrow(/domain/i);
  });

  it("applies the shared competitor rules: brand name, own sub-domains, duplicate names and the cap", async () => {
    const { userId, site } = await setup("ob2b@example.com");
    const added = await addCompetitors(t.db, {
      actorId: userId,
      websiteId: site.id,
      competitors: [
        { name: "canvasly", domain: "other-brand.com" },
        { name: "Blog", domain: "blog.ob2b.io" },
        { name: "Figma", domain: "figma.com" },
        { name: "FIGMA", domain: "figma.io" },
      ],
    });
    expect(added.map((c) => c.name)).toEqual(["Figma"]);
    const many = Array.from({ length: MAX_COMPETITORS }, (_, i) => ({ name: `C${i}`, domain: `c${i}.com` }));
    await expect(addCompetitors(t.db, { actorId: userId, websiteId: site.id, competitors: many })).rejects.toThrow(`at most ${MAX_COMPETITORS}`);
  });

  it("creates topics and prompts, de-duplicates case-insensitively and classifies branded prompts", async () => {
    const { userId, site } = await setup("ob3@example.com");
    const r = await addTrackedPrompts(t.db, {
      actorId: userId,
      websiteId: site.id,
      topics: [
        { name: "Design tools", prompts: ["Best AI design tools for startups", "best ai design tools for startups", "Is Canvasly good for teams?"] },
        { name: "Design tools", prompts: ["How do design tokens work?"] },
      ],
    });
    expect(r.created).toBe(3);
    expect(r.skipped).toBe(1);
    const topicRows = await t.db.select().from(topics).where(eq(topics.websiteId, site.id));
    expect(topicRows).toHaveLength(1);
    const promptRows = await t.db.select().from(prompts).where(eq(prompts.websiteId, site.id));
    expect(promptRows.find((p) => p.text.startsWith("Is Canvasly"))?.type).toBe("branded");
    expect(promptRows.find((p) => p.text.startsWith("Best AI"))?.type).toBe("non_branded");
    const again = await addTrackedPrompts(t.db, { actorId: userId, websiteId: site.id, topics: [{ name: "Design tools", prompts: ["HOW DO DESIGN TOKENS WORK?"] }] });
    expect(again).toEqual({ created: 0, skipped: 1 });
  });

  it("enforces the plan's prompt limit", async () => {
    const { userId, site } = await setup("ob4@example.com");
    const many = Array.from({ length: PROMPT_LIMITS.free + 5 }, (_, i) => `question number ${i} about design`);
    await expect(addTrackedPrompts(t.db, { actorId: userId, websiteId: site.id, topics: [{ name: "Bulk", prompts: many }] })).rejects.toThrow(/limit/i);
    const rows = await t.db.select().from(prompts).where(eq(prompts.websiteId, site.id));
    expect(rows).toHaveLength(0); // all-or-nothing
  });

  it("saves audience (country, locations, personas) idempotently", async () => {
    const { userId, site } = await setup("ob5@example.com");
    await saveAudience(t.db, {
      actorId: userId,
      websiteId: site.id,
      country: "kr",
      locations: [{ name: "Seoul", country: "KR" }, { name: "seoul", country: "KR" }],
      personas: [{ name: "Product designer", description: "Designs UI" }],
    });
    await saveAudience(t.db, { actorId: userId, websiteId: site.id, country: "KR", locations: [{ name: "Seoul", country: "KR" }], personas: [{ name: "product designer", description: "" }] });
    const [w] = await t.db.select().from(websites).where(eq(websites.id, site.id));
    expect(w.country).toBe("KR");
    expect(await t.db.select().from(locations).where(eq(locations.websiteId, site.id))).toHaveLength(1);
    expect(await t.db.select().from(personas).where(eq(personas.websiteId, site.id))).toHaveLength(1);
  });

  it("creates one default schedule, attaches unscheduled prompts and completes onboarding", async () => {
    const { userId, site } = await setup("ob6@example.com");
    await addTrackedPrompts(t.db, { actorId: userId, websiteId: site.id, topics: [{ name: "T", prompts: ["what is the best canvas tool"] }] });
    await saveMonitoringSchedule(t.db, { actorId: userId, websiteId: site.id, cadence: "weekly" });
    await saveMonitoringSchedule(t.db, { actorId: userId, websiteId: site.id, cadence: "daily" });
    const schedules = await t.db.select().from(promptSchedules).where(eq(promptSchedules.websiteId, site.id));
    expect(schedules).toHaveLength(1);
    expect(schedules[0].cadence).toBe("daily");
    const [p] = await t.db.select().from(prompts).where(eq(prompts.websiteId, site.id));
    expect(p.scheduleId).toBe(schedules[0].id);
    await expect(saveMonitoringSchedule(t.db, { actorId: userId, websiteId: site.id, cadence: "hourly" as never })).rejects.toThrow();
    const done = await completeOnboarding(t.db, { actorId: userId, websiteId: site.id });
    expect(done.onboardedAt).toBeInstanceOf(Date);
  });

  it("rejects users without access and members without prompt rights", async () => {
    const { userId, orgId, site } = await setup("ob7@example.com");
    const stranger = await ensureUserWithOrg(t.db, { email: "stranger7@example.com" });
    await expect(addCompetitors(t.db, { actorId: stranger.user.id, websiteId: site.id, competitors: [{ name: "a", domain: "a.com" }] })).rejects.toBeInstanceOf(ForbiddenError);
    const { token } = await createInvite(t.db, { actorId: userId, organizationId: orgId, email: "billing7@example.com", role: "billing" });
    const billing = await ensureUserWithOrg(t.db, { email: "billing7@example.com" });
    await acceptInvite(t.db, { token, userId: billing.user.id });
    await expect(addTrackedPrompts(t.db, { actorId: billing.user.id, websiteId: site.id, topics: [{ name: "x", prompts: ["some question here"] }] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("onboarding hardening", () => {
  it("keeps the plan limit under concurrent submissions", async () => {
    const { userId, site } = await setup("ob8@example.com");
    const batch = (k: number) => Array.from({ length: 30 }, (_, i) => `concurrent prompt ${k}-${i} about canvases`);
    const results = await Promise.allSettled([
      addTrackedPrompts(t.db, { actorId: userId, websiteId: site.id, topics: [{ name: "A", prompts: batch(1) }] }),
      addTrackedPrompts(t.db, { actorId: userId, websiteId: site.id, topics: [{ name: "B", prompts: batch(2) }] }),
    ]);
    const live = await t.db.select().from(prompts).where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
    expect(live.length).toBeLessThanOrEqual(PROMPT_LIMITS.free);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("templatePrompts (no-LLM fallback)", () => {
  it("prefers the user-confirmed product list over a tagline", () => {
    const out = templatePrompts({ name: "Vercel", domain: "vercel.com", description: "The autonomous stack for every app and agent.", products: ["Hosting", "AI SDK"] }, []);
    const all = out.flatMap((t) => t.prompts);
    expect(all).toContain("what is the best hosting");
    expect(all).toContain("best ai sdk alternatives");
    expect(all.some((p) => p.includes("autonomous stack"))).toBe(false);
  });

  it("builds category prompts from the brand profile without inventing competitors", () => {
    const topicsOut = templatePrompts({ name: "Canvasly", domain: "canvasly.io", description: "AI design canvas for product teams", headlines: [], productHints: [] }, []);
    const all = topicsOut.flatMap((t) => t.prompts);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.some((p) => /canvasly/i.test(p))).toBe(true);
    expect(all.every((p) => !/figma|canva\b/i.test(p))).toBe(true);
    const withComp = templatePrompts({ name: "Canvasly", domain: "canvasly.io" }, [{ name: "Figma", domain: "figma.com" }]);
    expect(withComp.flatMap((t) => t.prompts).some((p) => /Canvasly vs Figma/i.test(p))).toBe(true);
  });
});
