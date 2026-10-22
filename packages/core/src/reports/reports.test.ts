import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import {
  users,
  orgMembers,
  websiteMembers,
  customRoles,
  prompts,
  competitors,
  contentItems,
  websites,
} from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import {
  listScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  sendScheduledReportNow,
  getPublicReportByShareId,
  renderReportPdfBuffer,
} from "./index";

describe("report builder (chart composition, recipients/schedule, Slack digest, PDF export & public share links)", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, {
      email: "reports-owner@example.com",
      name: "Reports Owner",
    });
    const site = await createWebsite(t.db, {
      organizationId,
      userId: user.id,
      domain: "canvasly.io",
      name: "Canvasly",
    });
    c = { actorId: user.id, websiteId: site.id };

    await t.db.insert(competitors).values({
      websiteId: site.id,
      domain: "figma.com",
      name: "Figma",
    });
    await t.db.insert(prompts).values({
      websiteId: site.id,
      text: "best ai design canvas for enterprise teams",
      type: "non_branded",
      volumeEstimate: 4100,
    });
    await t.db.insert(contentItems).values({
      websiteId: site.id,
      title: "Canvasly vs Figma Enterprise Comparison 2026",
      targetUrl: "https://canvasly.io/blog/canvasly-vs-figma-2026",
      status: "draft",
    });

    // Viewer user
    const [vUser] = await t.db
      .insert(users)
      .values({ email: "reports-viewer@example.com", name: "Reports Viewer" })
      .returning();
    const [vRole] = await t.db
      .insert(customRoles)
      .values({
        organizationId,
        name: "ReportsViewerRole",
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
      email: "reports-outsider@example.com",
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

  it("seeds default AI Search and Content Proposal reports, supports chart composition CRUD, and validates recipients & Slack channels", async () => {
    const initial = await listScheduledReports(t.db, c.websiteId);
    expect(initial.length).toBe(2);
    expect(initial.some((r) => r.reportType === "ai_search" && r.sharePath.startsWith("/report/rpt_"))).toBe(true);
    expect(
      initial.some((r) => r.reportType === "content_proposal" && r.sharePath.startsWith("/report/content/cpr_")),
    ).toBe(true);

    // Invalid email rejected
    await expect(
      createScheduledReport(t.db, {
        actorId: c.actorId,
        websiteId: c.websiteId,
        name: "Bad Email Report",
        charts: ["mention_rate"],
        recipients: ["not-an-email"],
      }),
    ).rejects.toThrow(DomainError);

    // Invalid Slack channel rejected
    await expect(
      createScheduledReport(t.db, {
        actorId: c.actorId,
        websiteId: c.websiteId,
        name: "Bad Slack Report",
        charts: ["mention_rate"],
        slackChannel: "#bad channel spaces!",
      }),
    ).rejects.toThrow(DomainError);

    // Valid custom report creation + update
    const created = await createScheduledReport(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      name: "Q4 Board AI Visibility & Content Deck",
      reportType: "content_proposal",
      charts: ["mention_rate", "share_of_voice", "prompt_gaps", "content_proposals"],
      recipients: ["board@canvasly.io, vp-marketing@canvasly.io"],
      cadence: "weekly",
      slackChannel: "leadership-aeo",
    });
    expect(created.slackChannel).toBe("#leadership-aeo");
    expect(created.recipients).toEqual(["board@canvasly.io", "vp-marketing@canvasly.io"]);
    expect(created.sharePath).toBe(`/report/content/${created.shareId}`);

    const updated = await updateScheduledReport(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      reportId: created.id,
      name: "Q4 Executive AI Search & Content Deck",
      cadence: "biweekly",
      charts: ["mention_rate", "citation_rate", "content_proposals"],
    });
    expect(updated.name).toBe("Q4 Executive AI Search & Content Deck");
    expect(updated.cadence).toBe("biweekly");
    expect(updated.charts).toEqual(["mention_rate", "citation_rate", "content_proposals"]);
  });

  it("dispatches reports (Send now + Slack digest), generates valid %PDF-1.4 binary exports, and serves PII-free public share links", async () => {
    const reports = await listScheduledReports(t.db, c.websiteId);
    const target = reports[0]!;

    const sent = await sendScheduledReportNow(t.db, {
      actorId: c.actorId,
      websiteId: c.websiteId,
      reportId: target.id,
    });
    expect(sent.recipientCount).toBeGreaterThanOrEqual(1);
    expect(sent.slackDigestPreview).toContain(target.name);
    expect(sent.slackDigestPreview).toContain("Mention Rate:");

    // Public share link resolves without exposing recipient emails or slackChannel
    const pub = await getPublicReportByShareId(t.db, target.shareId);
    expect(pub.brandName).toBe("Canvasly");
    expect(pub.name).toBe(target.name);
    expect("recipients" in (pub as unknown as Record<string, unknown>)).toBe(false);
    expect("slackChannel" in (pub as unknown as Record<string, unknown>)).toBe(false);

    // PDF generator produces valid %PDF-1.4 document with %%EOF
    const pdfBuf = renderReportPdfBuffer(pub);
    const pdfText = pdfBuf.toString("utf8");
    expect(pdfText.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdfText).toContain("EXECUTIVE AI SEARCH KPIs");
    expect(pdfText.trim().endsWith("%%EOF")).toBe(true);
  });

  it("enforces RBAC, tenant isolation, and revokes public access when workspace is soft-deleted", async () => {
    const reports = await listScheduledReports(t.db, c.websiteId);
    const target = reports[0]!;

    // Viewer & outsider cannot modify or delete
    await expect(
      deleteScheduledReport(t.db, {
        actorId: viewerId,
        websiteId: c.websiteId,
        reportId: target.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      sendScheduledReportNow(t.db, {
        actorId: outsider.actorId,
        websiteId: c.websiteId,
        reportId: target.id,
      }),
    ).rejects.toThrow(ForbiddenError);

    // Soft-deleting a website immediately invalidates its public report share link
    const [outReport] = await listScheduledReports(t.db, outsider.websiteId);
    expect(outReport).toBeDefined();
    await t.db
      .update(websites)
      .set({ deletedAt: new Date() })
      .where(eq(websites.id, outsider.websiteId));

    await expect(getPublicReportByShareId(t.db, outReport!.shareId)).rejects.toThrow(
      NotFoundError,
    );
  });
});
