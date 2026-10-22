import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import {
  users,
  orgMembers,
  websiteMembers,
  customRoles,
  prompts,
  contentItems,
} from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError } from "../org/errors";
import {
  runSiteHealthCrawl,
  runStagingReleaseCheck,
  getSiteHealthSummary,
  createSiteHealthPage,
  updatePageOptimization,
  verifyLivePageContent,
  deleteSiteHealthPage,
} from "./index";

describe("site health engine (AI crawler accessibility, keywords, staging checks, sitemap/properties, optimization board & live verification)", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, {
      email: "sitehealth-owner@example.com",
      name: "SiteHealth Owner",
    });
    const site = await createWebsite(t.db, {
      organizationId,
      userId: user.id,
      domain: "canvasly.io",
      name: "Canvasly",
    });
    c = { actorId: user.id, websiteId: site.id };

    await t.db.insert(prompts).values({
      websiteId: site.id,
      text: "best ai design canvas for product teams",
      type: "non_branded",
      volumeEstimate: 3800,
    });

    await t.db.insert(contentItems).values({
      websiteId: site.id,
      title: "Canvasly SOC2 & Enterprise Security Guide",
      targetUrl: "https://canvasly.io/security/soc2",
      status: "published",
    });

    // Viewer user
    const [vUser] = await t.db
      .insert(users)
      .values({ email: "sitehealth-viewer@example.com", name: "SiteHealth Viewer" })
      .returning();
    const [vRole] = await t.db
      .insert(customRoles)
      .values({
        organizationId,
        name: "SiteHealthViewerRole",
        permissions: ["websites:read", "content:read"],
      })
      .returning();
    await t.db.insert(orgMembers).values({
      organizationId,
      userId: vUser!.id,
      role: "custom",
      customRoleId: vRole!.id,
    });
    await t.db.insert(websiteMembers).values({
      websiteId: site.id,
      userId: vUser!.id,
      role: "member",
    });
    viewerId = vUser!.id;

    // Outsider tenant
    const outOrg = await ensureUserWithOrg(t.db, {
      email: "sitehealth-outsider@example.com",
      name: "Outsider",
    });
    const outSite = await createWebsite(t.db, {
      organizationId: outOrg.organizationId,
      userId: outOrg.user.id,
      domain: "outsider.io",
      name: "Outsider",
    });
    outsider = { actorId: outOrg.user.id, websiteId: outSite.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("crawls site health pages, computes 10-bot AI accessibility matrix (OAI-SearchBot, Claude-SearchBot, PerplexityBot), keywords, and properties", async () => {
    const [r1, r2] = await Promise.all([
      runSiteHealthCrawl(t.db, c),
      runSiteHealthCrawl(t.db, c),
    ]);
    expect(r1.created + r2.created).toBeGreaterThanOrEqual(6);

    const summary = await getSiteHealthSummary(t.db, c.websiteId);
    expect(summary.stats.totalPages).toBeGreaterThanOrEqual(6);
    expect(summary.botAccessMatrix.length).toBe(10);
    expect(summary.botAccessMatrix.some((b) => b.bot === "OAI-SearchBot")).toBe(true);
    expect(summary.botAccessMatrix.some((b) => b.bot === "Claude-SearchBot")).toBe(true);
    expect(summary.botAccessMatrix.some((b) => b.bot === "PerplexityBot")).toBe(true);
    expect(summary.keywords.length).toBeGreaterThanOrEqual(6);
    expect(summary.properties.length).toBeGreaterThanOrEqual(3);
  });

  it("transitions pages through the Optimization Board (needs_edit -> staged -> verified_live) and preserves verified state across re-crawls", async () => {
    const before = await getSiteHealthSummary(t.db, c.websiteId);
    const blogPage = before.pages.find((p) => p.path === "/blog/ai-design-tools-2026");
    expect(blogPage).toBeDefined();
    expect(blogPage!.optimizationStatus).toBe("needs_edit");

    // Stage optimization
    const staged = await updatePageOptimization(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      pageId: blogPage!.id,
      optimizationStatus: "staged",
      recommendation: "Unblocked Claude-SearchBot in staging robots.txt",
    });
    expect(staged.optimizationStatus).toBe("staged");

    // Live content verification
    const verified = await verifyLivePageContent(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      pageId: blogPage!.id,
    });
    expect(verified.verificationHash).toMatch(/^sha256-/);

    // Re-crawl and confirm verified_live status is preserved
    await runSiteHealthCrawl(t.db, c);
    const after = await getSiteHealthSummary(t.db, c.websiteId);
    const updatedBlog = after.pages.find((p) => p.id === blogPage!.id);
    expect(updatedBlog?.optimizationStatus).toBe("verified_live");
    expect(updatedBlog?.aiAccessible).toBe(true);
    expect(updatedBlog?.healthStatus).toBe("pass");
  });

  it("validates staging release checks, blocks SSRF/off-domain page URLs, and enforces RBAC & tenant isolation", async () => {
    const stagingRes = await runStagingReleaseCheck(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      stagingHost: "staging.canvasly.io",
    });
    expect(stagingRes.checked).toBeGreaterThanOrEqual(6);

    // SSRF staging host blocked
    await expect(
      runStagingReleaseCheck(t.db, {
        actorId: c.actorId,
        websiteId: c.websiteId,
        stagingHost: "127.0.0.1",
      }),
    ).rejects.toThrow(DomainError);

    // Off-domain page URL blocked
    await expect(
      createSiteHealthPage(t.db, {
        actorId: c.actorId,
        websiteId: c.websiteId,
        url: "https://evil-competitor.com/pricing",
        title: "Off domain page",
      }),
    ).rejects.toThrow(DomainError);

    // Valid workspace path succeeds
    const created = await createSiteHealthPage(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      url: "/solutions/design-systems",
      title: "Canvasly Design Systems Solution",
      property: "Marketing & Core",
      keyword: "ai design system governance",
      position: 3,
    });
    expect(created.url).toBe("https://canvasly.io/solutions/design-systems");

    // Viewer & outsider blocked
    await expect(
      deleteSiteHealthPage(t.db, {
        actorId: viewerId,
        websiteId: c.websiteId,
        pageId: created.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      deleteSiteHealthPage(t.db, {
        actorId: outsider.actorId,
        websiteId: c.websiteId,
        pageId: created.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    await deleteSiteHealthPage(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      pageId: created.id,
    });
  });
});
