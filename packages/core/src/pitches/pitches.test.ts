import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { creditBalances, orgMembers, pitches, prompts, responses, users, websiteMembers } from "@athena/db";
import { createWebsite, ensureUserWithOrg } from "../tenancy";
import { createGroup, setWebsiteGroup } from "../org/groups";
import { getOrgBalance } from "../billing/credits";
import {
  allocateGroupCredits,
  createGroupSavedView,
  createPitch,
  deleteGroupSavedView,
  deletePitch,
  ensureDefaultGroup,
  getGroupDashboardData,
  getPitchUsage,
  getPublicPitchByShareId,
  listPitches,
  validateProspectUrl,
  writePitchRewrite,
  type PitchCollector,
  type PitchRewriteWriter,
} from "./index";

const chatgpt: PitchCollector = {
  model: "chatgpt",
  collect: async (prompt) => ({ text: `For "${prompt}": 1. Linear — fast issue tracking. 2. Jira — enterprise standard. Source: https://linear.app/docs`, citations: [{ url: "https://linear.app/docs" }], provider: "openai:gpt-4.1" }),
};
const flaky: PitchCollector = {
  model: "perplexity",
  collect: async (prompt) => {
    if (prompt === "jira alternatives") throw new Error("HTTP 503");
    return { text: "Jira is the most common choice.", citations: [{ url: "https://atlassian.com/software/jira" }], provider: "perplexity:sonar" };
  },
};
const okWriter: PitchRewriteWriter = async () => ({ ok: true, provider: "anthropic", afterCopy: "Asana is a work management tool for teams. [add customer examples]", faq: [{ question: "What is Asana?", answer: "A work management tool." }] });

async function bootstrapUser(
  db: TestDb["db"],
  opts: { email: string; name: string; website: { name: string; domain: string } },
) {
  const { user, organizationId } = await ensureUserWithOrg(db, {
    email: opts.email,
    name: opts.name,
  });
  const website = await createWebsite(db, {
    userId: user.id,
    organizationId,
    name: opts.website.name,
    domain: opts.website.domain,
  });
  return { user, organizationId, website };
}

describe("@athena/core/pitches — Pitch Workspace & Agency Groups", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  it("validates prospect URLs and blocks SSRF loopback/private/metadata hosts", () => {
    const valid = validateProspectUrl("linear.app/features");
    expect(valid.normalizedUrl).toBe("https://linear.app/features");
    expect(valid.domain).toBe("linear.app");
    expect(valid.inferredBrandName).toBe("Linear");

    expect(() => validateProspectUrl("http://localhost:3000")).toThrow(/private\/loopback/i);
    expect(() => validateProspectUrl("http://127.0.0.1/admin")).toThrow(/private\/loopback/i);
    expect(() => validateProspectUrl("http://169.254.169.254/latest/meta-data")).toThrow(
      /private\/loopback/i,
    );
    expect(() => validateProspectUrl("https://192.168.1.20")).toThrow(/private\/loopback/i);
    expect(() => validateProspectUrl("javascript:alert(1)")).toThrow(/http/i);
  });

  it("measures pitches from collected AI answers, charging 1 credit per answer and refunding failures", async () => {
    const owner = await bootstrapUser(t.db, { email: "pitch-owner@test.com", name: "Pitch Owner", website: { name: "Agency", domain: "agency.io" } });
    const base = { actorId: owner.user.id, organizationId: owner.organizationId, websiteUrl: "https://linear.app", competitors: ["Jira"] };
    await expect(createPitch(t.db, { ...base, prompts: ["best issue tracker"], collectors: [] })).rejects.toThrow(/AI provider/);
    await expect(createPitch(t.db, { ...base, prompts: [], collectors: [chatgpt] })).rejects.toThrow(/buyer question/);
    expect(await getOrgBalance(t.db, owner.organizationId)).toBe(300);

    const pitch = await createPitch(t.db, { ...base, prompts: ["best issue tracker", "jira alternatives"], collectors: [chatgpt, flaky] });
    expect(pitch).toMatchObject({ brandName: "Linear", domain: "linear.app", kind: "visibility" });
    expect(pitch.shareId).toMatch(/^pitch_[0-9a-f]{32}$/);
    const p = pitch.payload!;
    // chatgpt answered both questions (Linear listed and cited; in the "jira alternatives" answer Jira is named first, so Linear is #2);
    // the flaky model answered one question naming only Jira and failed once
    expect(p.totals).toEqual({ answers: 3, mentionRatePct: 66.7, citationRatePct: 66.7, shareOfVoicePct: 40, avgPosition: 1.5, simulatedSharePct: 0 });
    expect(p.failures).toEqual([{ prompt: "jira alternatives", model: "perplexity" }]);
    expect(p.competitorSov).toEqual([{ name: "Jira", isOwn: false, mentions: 3, sovPct: 60 }, { name: "Linear", isOwn: true, mentions: 2, sovPct: 40 }]);
    expect(p.topSources[0]).toEqual({ domain: "linear.app", citations: 2, isOwn: true });
    expect(p.byModel).toEqual([{ model: "chatgpt", answers: 2, mentionRatePct: 100, citationRatePct: 100 }, { model: "perplexity", answers: 1, mentionRatePct: 0, citationRatePct: 0 }]);
    // 4 reserved, 1 refunded
    expect(await getOrgBalance(t.db, owner.organizationId)).toBe(297);

    const pub = await getPublicPitchByShareId(t.db, pitch.shareId);
    expect(pub).toMatchObject({ brandName: "Linear", payload: { totals: { answers: 3 } } });
    expect(JSON.stringify(pub)).not.toContain(owner.organizationId);

    // too few credits: nothing is collected or charged
    await t.db.update(creditBalances).set({ balance: 1 }).where(eq(creditBalances.organizationId, owner.organizationId));
    await expect(createPitch(t.db, { ...base, prompts: ["best issue tracker", "jira alternatives"], collectors: [chatgpt, flaky] })).rejects.toThrow(/needs 4 credits/);
    expect(await getOrgBalance(t.db, owner.organizationId)).toBe(1);
  });

  it("enforces the monthly limit before spending credits, hides legacy invented pitches and writes rewrites only with an AI provider", async () => {
    const owner = await bootstrapUser(t.db, { email: "quota-owner@test.com", name: "Quota Owner", website: { name: "Agency Two", domain: "agency2.io" } });
    const base = { actorId: owner.user.id, organizationId: owner.organizationId, prompts: ["best issue tracker"], collectors: [chatgpt] };
    const p1 = await createPitch(t.db, { ...base, websiteUrl: "https://linear.app" });
    const p2 = await createPitch(t.db, { ...base, websiteUrl: "https://asana.com", kind: "content" });
    expect(p2.sharePath).toBe(`/report/content/${p2.shareId}`);
    const p3 = await createPitch(t.db, { ...base, websiteUrl: "https://notion.so" });
    await deletePitch(t.db, { actorId: owner.user.id, organizationId: owner.organizationId, pitchId: p3.id });
    await expect(getPublicPitchByShareId(t.db, p3.shareId)).rejects.toThrow(/not found/i);
    const before = await getOrgBalance(t.db, owner.organizationId);
    await expect(createPitch(t.db, { ...base, websiteUrl: "https://monday.com" })).rejects.toThrow(/Monthly pitch limit/);
    expect(await getOrgBalance(t.db, owner.organizationId)).toBe(before);
    expect((await getPitchUsage(t.db, { actorId: owner.user.id, organizationId: owner.organizationId })).remaining).toBe(0);

    // a pitch stored by the earlier generator (invented numbers) is listed without data and is not public
    const [legacy] = await t.db.insert(pitches).values({ organizationId: owner.organizationId, websiteUrl: "https://acme.io", brandName: "Acme Cloud", shareId: `pitch_${"c".repeat(32)}`, kind: "visibility", payload: { kpis: { mentionRatePct: 31.2 } }, createdAt: new Date(Date.UTC(2020, 0, 1)) }).returning();
    expect((await listPitches(t.db, { actorId: owner.user.id, organizationId: owner.organizationId })).find((x) => x.id === legacy!.id)?.payload).toBeNull();
    await expect(getPublicPitchByShareId(t.db, legacy!.shareId)).rejects.toThrow(/not found/i);

    const copy = "Asana helps teams orchestrate their work, from daily tasks to strategic initiatives, with timelines, boards and automated workflows.";
    await expect(writePitchRewrite(t.db, { actorId: owner.user.id, organizationId: owner.organizationId, pitchId: p2.id, existingCopy: "too short", writer: okWriter })).rejects.toThrow(/paragraph/);
    await expect(writePitchRewrite(t.db, { actorId: owner.user.id, organizationId: owner.organizationId, pitchId: p2.id, existingCopy: copy, writer: async () => ({ ok: false, reason: "unavailable" }) })).rejects.toThrow(/none is configured/);
    await expect(writePitchRewrite(t.db, { actorId: owner.user.id, organizationId: owner.organizationId, pitchId: p2.id, existingCopy: copy, targetPageUrl: "https://evil.example/x", writer: okWriter })).rejects.toThrow(/prospect's site/);
    const rewritten = await writePitchRewrite(t.db, { actorId: owner.user.id, organizationId: owner.organizationId, pitchId: p2.id, existingCopy: copy, targetPageUrl: "https://asana.com/product", writer: okWriter });
    expect(rewritten.payload!.rewrite).toMatchObject({ beforeCopy: copy, writtenBy: "anthropic", targetPageUrl: "https://asana.com/product", focusPrompt: "best issue tracker", faq: [{ question: "What is Asana?", answer: "A work management tool." }] });

    // members without content:write cannot create pitches
    const outsider = await bootstrapUser(t.db, { email: "pitch-outsider@test.com", name: "Outsider", website: { name: "Other", domain: "other.io" } });
    await expect(createPitch(t.db, { ...base, actorId: outsider.user.id, websiteUrl: "https://linear.app" })).rejects.toThrow();
    expect(p1.payload).not.toBeNull();
  });

  it("aggregates multi-website Group Dashboard metrics, manages group saved views, and atomically allocates shared group credits", async () => {
    const owner = await bootstrapUser(t.db, {
      email: "group-owner@test.com",
      name: "Group Owner",
      website: { name: "Brand Alpha", domain: "alpha.io" },
    });

    const defGroup = await ensureDefaultGroup(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
    });
    expect(defGroup.name).toBe("Core Brand Portfolio");

    // Seed prompt & response on Brand Alpha
    const [pr] = await t.db
      .insert(prompts)
      .values({
        websiteId: owner.website.id,
        text: "best workflow automation platform",
        volumeEstimate: 2500,
      })
      .returning();

    await t.db.insert(responses).values([
      {
        promptId: pr!.id,
        websiteId: owner.website.id,
        model: "gpt-4o",
        rawText: "Brand Alpha (https://alpha.io) is the leading automation suite.",
        mentioned: true,
        cited: true,
      },
      {
        promptId: pr!.id,
        websiteId: owner.website.id,
        model: "claude-3-7-sonnet",
        rawText: "Brand Alpha is widely recommended for teams.",
        mentioned: true,
        cited: false,
      },
    ]);

    // Create a Group Saved View
    const view = await createGroupSavedView(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      groupId: defGroup.id,
      name: "Alpha Focus View",
      filters: { domainFilter: "alpha.io" },
    });
    expect(view.name).toBe("Alpha Focus View");

    // Allocate 120 credits from Org Unallocated Pool -> Group Shared Pool
    const alloc1 = await allocateGroupCredits(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      groupId: defGroup.id,
      amount: 120,
      direction: "to_group",
      reason: "Q4 Agency Campaign Pool",
    });
    expect(alloc1.orgBalance).toBe(180); // 300 initial - 120
    expect(alloc1.groupBalance).toBe(120); // groups start empty; credits come from the organization pool

    // Return 70 credits from Group Shared Pool -> Org Unallocated Pool
    const alloc2 = await allocateGroupCredits(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      groupId: defGroup.id,
      amount: 70,
      direction: "to_org",
      reason: "Rebalance unused credits",
    });
    expect(alloc2.orgBalance).toBe(250);
    expect(alloc2.groupBalance).toBe(50);

    // Guard against over-allocation
    await expect(
      allocateGroupCredits(t.db, {
        actorId: owner.user.id,
        organizationId: owner.organizationId,
        groupId: defGroup.id,
        amount: 99999,
        direction: "to_group",
      }),
    ).rejects.toThrow(/Insufficient organization credits/i);

    const dash = await getGroupDashboardData(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      groupId: defGroup.id,
    });
    expect(dash.kpis.websiteCount).toBe(1);
    expect(dash.kpis.groupMentionRatePct).toBe(100);
    expect(dash.kpis.groupCitationRatePct).toBe(50);
    expect(dash.savedViews.some((v) => v.id === view.id)).toBe(true);
    expect(dash.billing.orgUnallocatedBalance).toBe(250);
    expect(dash.billing.groupSharedBalance).toBe(50);
    expect(dash.billing.ledger.map((l) => l.amount)).toEqual([-70, 120]);

    await deleteGroupSavedView(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      groupId: defGroup.id,
      viewId: view.id,
    });

    // Also verify createGroup + setWebsiteGroup integration
    const g2 = await createGroup(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      name: "EMEA Portfolio",
    });
    await setWebsiteGroup(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      websiteId: owner.website.id,
      groupId: g2.id,
    });
    const dash2 = await getGroupDashboardData(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      groupId: g2.id,
    });
    expect(dash2.kpis.websiteCount).toBe(1);
    expect(dash2.memberWebsites[0]?.domain).toBe("alpha.io");

    // a member who can access only one website does not see the others in the group
    const second = await createWebsite(t.db, { userId: owner.user.id, organizationId: owner.organizationId, name: "Brand Beta", domain: "beta.io", groupId: g2.id });
    const [member] = await t.db.insert(users).values({ email: "group-member@test.com", name: "Member" }).returning();
    await t.db.insert(orgMembers).values({ organizationId: owner.organizationId, userId: member!.id, role: "member" });
    await t.db.insert(websiteMembers).values({ websiteId: second.id, userId: member!.id, role: "member" });
    const scoped = await getGroupDashboardData(t.db, { actorId: member!.id, organizationId: owner.organizationId, groupId: g2.id });
    expect(scoped.memberWebsites.map((w) => w.domain)).toEqual(["beta.io"]);
    expect(scoped.availableWebsites.map((w) => w.domain)).toEqual(["beta.io"]);
    // Suppress unused import warning for creditBalances
    expect(creditBalances).toBeDefined();
  });
});
