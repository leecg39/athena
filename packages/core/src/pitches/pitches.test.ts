import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { creditBalances, organizations, prompts, responses } from "@athena/db";
import { createWebsite, ensureUserWithOrg } from "../tenancy";
import { createGroup, setWebsiteGroup } from "../org/groups";
import { getPublicReportByShareId } from "../reports";
import {
  allocateGroupCredits,
  createGroupSavedView,
  createPitch,
  deleteGroupSavedView,
  deletePitch,
  ensureDefaultGroup,
  getGroupDashboardData,
  getPitchUsage,
  listPitches,
  regeneratePitchRewrite,
  validateProspectUrl,
} from "./index";

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

  it("creates visibility & content rewrite pitches, enforces monthly quota even after soft-delete, and resolves public pitch view", async () => {
    const owner = await bootstrapUser(t.db, {
      email: "pitch-owner@test.com",
      name: "Pitch Owner",
      website: { name: "Agency Hub", domain: "agencyhub.io" },
    });
    const outsider = await bootstrapUser(t.db, {
      email: "pitch-outsider@test.com",
      name: "Outsider",
      website: { name: "Other Org", domain: "otherorg.io" },
    });

    // Free plan starts with 0/3 used this month
    const initialUsage = await getPitchUsage(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
    });
    expect(initialUsage.plan).toBe("free");
    expect(initialUsage.usedThisMonth).toBe(0);
    expect(initialUsage.monthlyLimit).toBe(3);

    // 1. Create a visibility pitch
    const p1 = await createPitch(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      websiteUrl: "https://figma.com",
      brandName: "Figma",
      kind: "visibility",
      industry: "Collaborative Design",
    });
    expect(p1.shareId).toMatch(/^pitch_/);
    expect(p1.sharePath).toBe(`/report/${p1.shareId}`);
    expect(p1.payload.kpis.mentionRatePct).toBeGreaterThan(0);

    // 2. Create a content rewrite pitch
    const p2 = await createPitch(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      websiteUrl: "https://notion.so",
      brandName: "Notion",
      kind: "content",
      targetPageUrl: "https://notion.so/enterprise",
      existingCopy: "Notion is an all-in-one workspace for notes and docs.",
      targetPrompts: ["best enterprise knowledge base software 2026"],
    });
    expect(p2.shareId).toMatch(/^cpitch_/);
    expect(p2.sharePath).toBe(`/report/content/${p2.shareId}`);
    expect(p2.payload.contentRewrite.focusPrompt).toBe(
      "best enterprise knowledge base software 2026",
    );
    expect(p2.payload.contentRewrite.afterCopy).toContain("Direct Answer Summary");
    expect(p2.payload.contentRewrite.jsonLdSchema).toContain("FAQPage");

    // Regenerate content rewrite on p1 (upgrades p1 to content rewrite pitch)
    const p1Upgraded = await regeneratePitchRewrite(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      pitchId: p1.id,
      targetPageUrl: "https://figma.com/enterprise-design-systems",
      focusPrompt: "best design system governance platform for enterprise",
    });
    expect(p1Upgraded.kind).toBe("content");
    expect(p1Upgraded.payload.contentRewrite.targetPageUrl).toBe(
      "https://figma.com/enterprise-design-systems",
    );

    // Resolve public share link via getPublicReportByShareId
    const pubPitch = await getPublicReportByShareId(t.db, p2.shareId);
    expect(pubPitch.isPitch).toBe(true);
    expect(pubPitch.brandName).toBe("Notion");
    expect(pubPitch.contentRewrite?.targetPageUrl).toBe("https://notion.so/enterprise");

    // Cross-tenant isolation check
    await expect(
      deletePitch(t.db, {
        actorId: outsider.user.id,
        organizationId: owner.organizationId,
        pitchId: p2.id,
      }),
    ).rejects.toThrow();

    // 3. Create 3rd pitch to reach free limit (3/3)
    const p3 = await createPitch(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      websiteUrl: "https://miro.com",
      kind: "visibility",
    });

    // Soft-delete p3 and verify that monthly quota STILL counts p3 (prevents create-then-delete quota bypass!)
    await deletePitch(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      pitchId: p3.id,
    });

    // Deleted pitch is no longer accessible via public shareId
    await expect(getPublicReportByShareId(t.db, p3.shareId)).rejects.toThrow(/not found/i);

    const afterDeleteUsage = await getPitchUsage(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
    });
    expect(afterDeleteUsage.usedThisMonth).toBe(3);
    expect(afterDeleteUsage.remaining).toBe(0);

    await expect(
      createPitch(t.db, {
        actorId: owner.user.id,
        organizationId: owner.organizationId,
        websiteUrl: "https://canva.com",
        kind: "visibility",
      }),
    ).rejects.toThrow(/Monthly pitch limit reached/i);

    // Upgrading organization plan to starter (limit 10) unlocks creation
    await t.db
      .update(organizations)
      .set({ plan: "starter" })
      .where(eq(organizations.id, owner.organizationId));

    const p4 = await createPitch(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
      websiteUrl: "https://canva.com",
      kind: "visibility",
    });
    expect(p4.brandName).toBe("Canva");

    const listed = await listPitches(t.db, {
      actorId: owner.user.id,
      organizationId: owner.organizationId,
    });
    expect(listed.length).toBe(3); // p1, p2, p4 (p3 was soft-deleted)
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
    expect(alloc1.groupBalance).toBe(370); // 250 initial group grant + 120

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
    expect(alloc2.groupBalance).toBe(300);

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
    expect(dash.billing.groupSharedBalance).toBe(300);
    expect(dash.billing.ledger.length).toBeGreaterThanOrEqual(3);

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

    // Suppress unused import warning for creditBalances
    expect(creditBalances).toBeDefined();
  });
});
