import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import {
  users,
  orgMembers,
  websiteMembers,
  customRoles,
  contentItems,
} from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError } from "../org/errors";
import {
  type SiteHealthFetcher,
  runSiteHealthCrawl,
  runStagingReleaseCheck,
  getSiteHealthSummary,
  createSiteHealthPage,
  updatePageOptimization,
  verifyLivePageContent,
  deleteSiteHealthPage,
} from "./index";

describe("site health engine (real HTTP crawl, RFC 9309 robots.txt, sitemap, staging comparison & live SHA-256 verification)", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  let blockBlogRobots = true;
  const prodResponses: Record<string, { status: number; body: string }> = {
    "https://canvasly.io/robots.txt": {
      status: 200,
      body: [
        "User-agent: *",
        "Allow: /",
        "User-agent: Claude-SearchBot",
        "Disallow: /blog",
        "User-agent: ClaudeBot",
        "Disallow: /blog",
      ].join("\n"),
    },
    "https://canvasly.io/llms.txt": {
      status: 200,
      body: "# Canvasly\n- /pricing: Plans and enterprise options\n- /docs/api: REST API reference\n",
    },
    "https://canvasly.io/sitemap.xml": {
      status: 200,
      body: [
        "<urlset>",
        "<url><loc>https://canvasly.io/</loc></url>",
        "<url><loc>https://canvasly.io/pricing</loc></url>",
        "<url><loc>https://canvasly.io/blog/ai-design-tools-2026</loc></url>",
        "<url><loc>https://canvasly.io/docs/api</loc></url>",
        "<url><loc>https://canvasly.io/old/features-legacy</loc></url>",
        "</urlset>",
      ].join(""),
    },
    "https://canvasly.io/": {
      status: 200,
      body: `<html><head><title>Canvasly — Collaborative Design Platform</title><script type="application/ld+json">{"@type":"SoftwareApplication"}</script></head><body>Home</body></html>`,
    },
    "https://canvasly.io/pricing": {
      status: 200,
      body: `<html><head><title>Canvasly Pricing</title><script type="application/ld+json">{"@type":"Product"}</script></head><body>Pricing</body></html>`,
    },
    "https://canvasly.io/blog/ai-design-tools-2026": {
      status: 200,
      body: `<html><head><title>AI Design Tools 2026</title><script type="application/ld+json">{"@type":"Article"}</script></head><body>Article body</body></html>`,
    },
    "https://canvasly.io/docs/api": {
      status: 200,
      body: `<html><head><title>Canvasly API Reference</title><script type="application/ld+json">{"@type":"TechArticle"}</script></head><body>Docs</body></html>`,
    },
    "https://canvasly.io/old/features-legacy": {
      status: 404,
      body: `<html><head><title>Not Found</title></head><body>404</body></html>`,
    },
    "https://canvasly.io/security/soc2": {
      status: 200,
      body: `<html><head><title>Canvasly SOC2 &amp; Enterprise Security Guide</title><script type="application/ld+json">{"@type":"WebPage"}</script></head><body>SOC2</body></html>`,
    },
  };

  const fetchPage: SiteHealthFetcher = async (url) => {
    if (url === "https://canvasly.io/robots.txt" && !blockBlogRobots) {
      return { status: 200, body: "User-agent: *\nAllow: /\n" };
    }
    if (url.startsWith("https://staging.canvasly.io")) {
      const path = new URL(url).pathname;
      if (path === "/robots.txt") {
        return { status: 200, body: "User-agent: GPTBot\nDisallow: /docs\nUser-agent: *\nAllow: /\n" };
      }
      if (path === "/old/features-legacy") return { status: 404, body: "Not found" };
      return { status: 200, body: "<html><head><title>Staging</title></head><body>OK</body></html>" };
    }
    return prodResponses[url] ?? { status: 404, body: "Not found" };
  };

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

    await t.db.insert(contentItems).values({
      websiteId: site.id,
      title: "Canvasly SOC2 & Enterprise Security Guide",
      targetUrl: "https://canvasly.io/security/soc2",
      status: "published",
    });

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

  it("does not crawl or fabricate pages on GET (empty before first crawl)", async () => {
    const empty = await getSiteHealthSummary(t.db, c.websiteId);
    expect(empty.stats.totalPages).toBe(0);
    expect(empty.pages).toEqual([]);
    expect(empty.keywords).toEqual([]);
  });

  it("crawls real URLs via fetchPage, evaluates RFC 9309 robots.txt across 10 AI bots, and extracts real titles & JSON-LD types", async () => {
    const r1 = await runSiteHealthCrawl(t.db, { ...c, fetchPage });
    expect(r1.created).toBe(6);

    const summary = await getSiteHealthSummary(t.db, c.websiteId);
    expect(summary.stats.totalPages).toBe(6);
    expect(summary.botAccessMatrix.length).toBe(10);
    // no fabricated keywords
    expect(summary.keywords).toEqual([]);

    const home = summary.pages.find((p) => p.path === "/")!;
    expect(home.title).toBe("Canvasly — Collaborative Design Platform");
    expect(home.schemaMarkup).toEqual(["SoftwareApplication"]);
    expect(home.llmsTxtPresent).toBe(true);
    expect(home.inSitemap).toBe(true);
    expect(home.healthStatus).toBe("pass");

    const blog = summary.pages.find((p) => p.path === "/blog/ai-design-tools-2026")!;
    expect(blog.healthStatus).toBe("warn");
    expect(blog.robotsBots.find((b) => b.bot === "Claude-SearchBot")?.status).toBe("blocked");
    expect(blog.robotsBots.find((b) => b.bot === "OAI-SearchBot")?.status).toBe("allowed");

    const legacy = summary.pages.find((p) => p.path === "/old/features-legacy")!;
    expect(legacy.statusCode).toBe(404);
    expect(legacy.healthStatus).toBe("fail");
  });

  it("verifies live page content against real HTTP & robots.txt and preserves verified state across re-crawls", async () => {
    const before = await getSiteHealthSummary(t.db, c.websiteId);
    const blogPage = before.pages.find((p) => p.path === "/blog/ai-design-tools-2026")!;
    const legacyPage = before.pages.find((p) => p.path === "/old/features-legacy")!;
    expect(blogPage.optimizationStatus).toBe("needs_edit");

    // 404 page cannot be marked verified_live
    await expect(
      verifyLivePageContent(t.db, { ...c, pageId: legacyPage.id, fetchPage }),
    ).rejects.toThrow(/HTTP 404/);

    const staged = await updatePageOptimization(t.db, {
      ...c,
      pageId: blogPage.id,
      optimizationStatus: "staged",
      recommendation: "Unblocked Claude-SearchBot in robots.txt",
    });
    expect(staged.optimizationStatus).toBe("staged");

    blockBlogRobots = false;
    const verified = await verifyLivePageContent(t.db, {
      ...c,
      pageId: blogPage.id,
      fetchPage,
    });
    expect(verified.verificationHash).toMatch(/^sha256-[0-9a-f]{16}$/);

    await runSiteHealthCrawl(t.db, { ...c, fetchPage });
    const after = await getSiteHealthSummary(t.db, c.websiteId);
    const updatedBlog = after.pages.find((p) => p.id === blogPage.id)!;
    expect(updatedBlog.optimizationStatus).toBe("verified_live");
    expect(updatedBlog.healthStatus).toBe("pass");
  });

  it("compares staging vs production via fetchPage, blocks SSRF/off-domain URLs, and enforces RBAC", async () => {
    const stagingRes = await runStagingReleaseCheck(t.db, {
      ...c,
      stagingHost: "staging.canvasly.io",
      fetchPage,
    });
    expect(stagingRes.checked).toBe(6);
    expect(stagingRes.regressions).toBeGreaterThanOrEqual(2); // /docs/api blocked for GPTBot + /old/features-legacy 404

    await expect(
      runStagingReleaseCheck(t.db, { ...c, stagingHost: "127.0.0.1", fetchPage }),
    ).rejects.toThrow(DomainError);

    await expect(
      createSiteHealthPage(t.db, {
        ...c,
        url: "https://evil-competitor.com/pricing",
        title: "Off domain page",
      }),
    ).rejects.toThrow(DomainError);

    const created = await createSiteHealthPage(t.db, {
      ...c,
      url: "/solutions/design-systems",
      title: "Canvasly Design Systems Solution",
      property: "Marketing & Core",
      keyword: "ai design system governance",
      position: 3,
    });
    expect(created.url).toBe("https://canvasly.io/solutions/design-systems");

    await expect(
      runSiteHealthCrawl(t.db, { actorId: viewerId, websiteId: c.websiteId, fetchPage }),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      deleteSiteHealthPage(t.db, { actorId: viewerId, websiteId: c.websiteId, pageId: created.id }),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      deleteSiteHealthPage(t.db, { actorId: outsider.actorId, websiteId: c.websiteId, pageId: created.id }),
    ).rejects.toThrow(ForbiddenError);

    await deleteSiteHealthPage(t.db, { ...c, pageId: created.id });
  });
});
