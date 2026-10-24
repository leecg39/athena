import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { users, orgMembers, websiteMembers, customRoles, prompts, competitors, contentItems, websites, responses, responseMentions, responseCitations, runs, scheduledReports, integrations, activityLog } from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import {
  listScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  sendScheduledReportNow,
  dispatchDueReports,
  getPublicReportByShareId,
  renderReportPdfBuffer,
  connectSlackWebhook,
  getSlackConnection,
  type ReportTransport,
} from "./index";

const KEY = "test-integrations-key-0123456789abcdef";
const APP = "https://app.example.com";
const HOOK = "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop";
const DAY = 86_400_000;

function recorder() {
  const emails: { to: string[]; subject: string; html: string; text: string }[] = [];
  const slack: { url: string; text: string }[] = [];
  const transport: ReportTransport = {
    email: async (m) => void emails.push(m),
    slack: async (url, text) => void slack.push({ url, text }),
  };
  return { emails, slack, transport };
}

describe("reports from collected answers only", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let empty: { actorId: string; websiteId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "reports-owner@example.com", name: "Owner" });
    const site = await createWebsite(t.db, { organizationId, userId: user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: user.id, websiteId: site.id };
    const second = await createWebsite(t.db, { organizationId, userId: user.id, domain: "empty.io", name: "Empty" });
    empty = { actorId: user.id, websiteId: second.id };

    const [figma] = await t.db.insert(competitors).values({ websiteId: site.id, domain: "figma.com", name: "Figma" }).returning();
    const [pA] = await t.db.insert(prompts).values({ websiteId: site.id, text: "best design canvas", type: "non_branded", volumeEstimate: 900 }).returning();
    const [pB] = await t.db.insert(prompts).values({ websiteId: site.id, text: "design tools for agencies", type: "non_branded" }).returning();
    await t.db.insert(contentItems).values({ websiteId: site.id, title: "Canvasly vs Figma", status: "draft" });
    const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();
    const now = Date.now();
    const rows = [
      { promptId: pA.id, model: "chatgpt", ranAt: new Date(now - 2 * DAY), mentioned: true, cited: true, position: 1, figma: true },
      { promptId: pB.id, model: "chatgpt", ranAt: new Date(now - 2 * DAY), mentioned: false, cited: false, position: null, figma: true },
      { promptId: pA.id, model: "perplexity", ranAt: new Date(now - DAY), mentioned: true, cited: false, position: 3, figma: false },
      { promptId: pB.id, model: "perplexity", ranAt: new Date(now - DAY), mentioned: false, cited: false, position: null, figma: false },
    ];
    for (const r of rows) {
      const [saved] = await t.db.insert(responses).values({ runId: run.id, websiteId: site.id, promptId: r.promptId, model: r.model, rawText: "x", ranAt: r.ranAt, mentioned: r.mentioned, cited: r.cited, position: r.position }).returning();
      if (r.mentioned) await t.db.insert(responseMentions).values({ responseId: saved.id, competitorId: null, name: "Canvasly" });
      if (r.figma) await t.db.insert(responseMentions).values({ responseId: saved.id, competitorId: figma.id, name: "Figma" });
      await t.db.insert(responseCitations).values({ responseId: saved.id, url: "https://g2.com/x", domain: "g2.com" });
      if (r.cited) await t.db.insert(responseCitations).values({ responseId: saved.id, url: "https://canvasly.io/a", domain: "canvasly.io", isBrand: true });
    }

    const [viewer] = await t.db.insert(users).values({ email: "reports-viewer@example.com", name: "Viewer" }).returning();
    const [role] = await t.db.insert(customRoles).values({ organizationId, name: "Reports Reader", permissions: ["websites:read", "content:read"] }).returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;
    const o = await ensureUserWithOrg(t.db, { email: "reports-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "outsider.io", name: "Outsider" });
    outsider = { actorId: o.user.id, websiteId: oSite.id };
  });
  afterAll(async () => {
    await t.close();
  });

  it("lists only reports the team created (nothing is seeded on view) and validates input", async () => {
    expect(await listScheduledReports(t.db, c)).toEqual([]);
    await expect(createScheduledReport(t.db, { ...c, name: "Bad", charts: ["mention_rate"], recipients: ["not-an-email"] })).rejects.toThrow(DomainError);
    await expect(createScheduledReport(t.db, { ...c, name: "Bad", charts: ["mention_rate"], slackChannel: "#bad channel!" })).rejects.toThrow(DomainError);
    const created = await createScheduledReport(t.db, { ...c, name: "Weekly AI search", charts: ["mention_rate", "share_of_voice", "prompt_gaps"], recipients: ["a@canvasly.io, b@canvasly.io"], cadence: "weekly", slackChannel: "aeo" });
    expect(created).toMatchObject({ recipients: ["a@canvasly.io", "b@canvasly.io"], slackChannel: "#aeo", lastSentAt: null, sharePath: `/report/${created.shareId}` });
    expect(created.shareId).toMatch(/^rpt_[0-9a-f]{32}$/);
    const updated = await updateScheduledReport(t.db, { ...c, reportId: created.id, cadence: "monthly", charts: ["mention_rate", "top_sources"] });
    expect(updated).toMatchObject({ cadence: "monthly", charts: ["mention_rate", "top_sources"] });
    expect((await listScheduledReports(t.db, c)).map((r) => r.id)).toEqual([created.id]);
  });

  it("builds report data from collected answers, with no invented fallbacks", async () => {
    const [report] = await listScheduledReports(t.db, c);
    const data = await getPublicReportByShareId(t.db, report!.shareId);
    expect(data.kpis).toMatchObject({ responses: 4, mentionRatePct: 50, citationRatePct: 25, shareOfVoicePct: 50, avgPosition: 2, activePrompts: 2 });
    expect(data.period.days).toBe(30);
    expect(data.daily.map((d) => [d.responses, d.mentionRatePct])).toEqual([[2, 50], [2, 50]]);
    expect(data.competitorSov).toEqual([
      { name: "Canvasly", isOwn: true, mentions: 2, sovPct: 50 },
      { name: "Figma", isOwn: false, mentions: 2, sovPct: 50 },
    ]);
    expect(data.topSources).toEqual([{ domain: "g2.com", citations: 4, isOwn: false }, { domain: "canvasly.io", citations: 1, isOwn: true }]);
    // the prompt whose answers never mention the brand is a gap; volume only when known
    expect(data.promptGaps).toEqual([{ prompt: "design tools for agencies", answers: 2, mentionRatePct: 0, volume: null }]);
    expect(data.searchValue).toEqual({ hasVolume: true, aiVisibleSearches: 900, trackedVolume: 900 });
    expect(data.contentProposals.map((p) => p.title)).toEqual(["Canvasly vs Figma"]);
    expect(data.crawler).toEqual({ pagesChecked: 0, aiAccessiblePct: null, checkedAt: null });
    expect("recipients" in data).toBe(false);

    const blank = await createScheduledReport(t.db, { ...empty, name: "Empty site", charts: ["mention_rate", "top_sources"] });
    const none = await getPublicReportByShareId(t.db, blank.shareId);
    expect(none.kpis).toMatchObject({ responses: 0, mentionRatePct: null, citationRatePct: null, shareOfVoicePct: null, avgPosition: null });
    expect(none).toMatchObject({ daily: [], competitorSov: [], topSources: [], promptGaps: [], contentProposals: [] });
    await expect(getPublicReportByShareId(t.db, "demo-Nike")).rejects.toThrow(NotFoundError);
  });

  it("sends only through configured channels and never claims a delivery that did not happen", async () => {
    const [report] = await listScheduledReports(t.db, c);
    await expect(sendScheduledReportNow(t.db, { ...c, reportId: report!.id, secretKey: KEY, appUrl: APP, transport: { email: null, slack: null } })).rejects.toThrow(/Nothing was sent/);
    expect((await listScheduledReports(t.db, c))[0]!.lastSentAt).toBeNull();

    const r = recorder();
    const sent = await sendScheduledReportNow(t.db, { ...c, reportId: report!.id, secretKey: KEY, appUrl: APP, transport: r.transport });
    expect(sent).toMatchObject({ emailed: 2, slackPosted: false, skipped: ["Slack isn't connected for this website"] });
    expect(r.emails[0]).toMatchObject({ to: ["a@canvasly.io", "b@canvasly.io"] });
    expect(r.emails[0]!.html).toContain(`${APP}/report/${report!.shareId}`);
    expect(r.emails[0]!.text).toContain("Mention rate: 50%");
    expect((await listScheduledReports(t.db, c))[0]!.lastSentAt).not.toBeNull();

    await expect(connectSlackWebhook(t.db, { ...c, webhookUrl: "https://evil.example.com/services/x", secretKey: KEY })).rejects.toThrow(/hooks\.slack\.com/);
    await connectSlackWebhook(t.db, { ...c, webhookUrl: HOOK, channel: "#aeo", secretKey: KEY });
    expect(await getSlackConnection(t.db, c)).toMatchObject({ connected: true, channel: "#aeo" });
    const [row] = await t.db.select().from(integrations).where(eq(integrations.websiteId, c.websiteId));
    expect(row!.secret).not.toContain("hooks.slack.com");
    const again = await sendScheduledReportNow(t.db, { ...c, reportId: report!.id, secretKey: KEY, appUrl: APP, transport: r.transport });
    expect(again).toMatchObject({ emailed: 2, slackPosted: true, skipped: [] });
    expect(r.slack[0]).toMatchObject({ url: HOOK });
    expect(r.slack[0]!.text).toContain("Mention rate: 50%");

    const failing: ReportTransport = { email: async () => { throw new Error("HTTP 500"); }, slack: null };
    const lastSent = (await listScheduledReports(t.db, c))[0]!.lastSentAt;
    await expect(sendScheduledReportNow(t.db, { ...c, reportId: report!.id, secretKey: KEY, appUrl: APP, transport: failing })).rejects.toThrow(/Email delivery failed/);
    expect((await listScheduledReports(t.db, c))[0]!.lastSentAt).toEqual(lastSent);
  });

  it("escapes Slack control text and caps manual sends per website per day", async () => {
    const r = recorder();
    const loud = await createScheduledReport(t.db, { ...c, name: "<!channel> digest", charts: ["mention_rate"], slackChannel: "#aeo" });
    await sendScheduledReportNow(t.db, { ...c, reportId: loud.id, secretKey: KEY, appUrl: APP, transport: r.transport });
    expect(r.slack[0]!.text).not.toContain("<!channel>");
    expect(r.slack[0]!.text).toContain("&lt;!channel&gt;");
    const [owner] = await t.db.select().from(users).where(eq(users.email, "reports-owner@example.com"));
    const [site] = await t.db.select().from(websites).where(eq(websites.id, c.websiteId));
    await t.db.insert(activityLog).values(Array.from({ length: 20 }, () => ({ organizationId: site!.organizationId, websiteId: c.websiteId, userId: owner!.id, entityType: "scheduled_report", entityId: loud.id, change: "dispatched" })));
    await expect(sendScheduledReportNow(t.db, { ...c, reportId: loud.id, secretKey: KEY, appUrl: APP, transport: r.transport })).rejects.toThrow(/20 times in the last 24 hours/);
    await deleteScheduledReport(t.db, { ...c, reportId: loud.id });
  });

  it("dispatches reports that are due by cadence", async () => {
    const [due] = await t.db.insert(scheduledReports).values({ websiteId: c.websiteId, name: "Old weekly", shareId: `rpt_${"a".repeat(32)}`, charts: ["mention_rate"], recipients: ["x@canvasly.io"], cadence: "weekly", createdAt: new Date(Date.now() - 8 * DAY) }).returning();
    await t.db.insert(scheduledReports).values({ websiteId: c.websiteId, name: "Fresh weekly", shareId: `rpt_${"b".repeat(32)}`, charts: ["mention_rate"], recipients: ["y@canvasly.io"], cadence: "weekly", createdAt: new Date(Date.now() - DAY) });
    const r = recorder();
    const res = await dispatchDueReports(t.db, { now: new Date(), secretKey: KEY, appUrl: APP, transport: { email: r.transport.email, slack: null } });
    expect(res.sent).toContain(due.id);
    expect(r.emails.flatMap((e) => e.to)).toContain("x@canvasly.io");
    expect(r.emails.flatMap((e) => e.to)).not.toContain("y@canvasly.io");
  });

  it("renders a PDF with dashes for unknown values and enforces RBAC", async () => {
    const blank = (await listScheduledReports(t.db, empty))[0]!;
    const pdf = renderReportPdfBuffer(await getPublicReportByShareId(t.db, blank.shareId)).toString("utf8");
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf).toContain("Mention rate: -");
    expect(pdf).toContain("No answers were collected in this period");
    expect(pdf.trim().endsWith("%%EOF")).toBe(true);

    const [report] = await listScheduledReports(t.db, c);
    await expect(listScheduledReports(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toHaveLength(3);
    await expect(deleteScheduledReport(t.db, { actorId: viewerId, websiteId: c.websiteId, reportId: report!.id })).rejects.toThrow(ForbiddenError);
    await expect(sendScheduledReportNow(t.db, { actorId: outsider.actorId, websiteId: c.websiteId, reportId: report!.id, secretKey: KEY, appUrl: APP, transport: recorder().transport })).rejects.toThrow(ForbiddenError);
    await expect(listScheduledReports(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toThrow(ForbiddenError);

    const own = await createScheduledReport(t.db, { ...outsider, name: "Outsider report", charts: ["mention_rate"] });
    await t.db.update(websites).set({ deletedAt: new Date() }).where(eq(websites.id, outsider.websiteId));
    await expect(getPublicReportByShareId(t.db, own.shareId)).rejects.toThrow(NotFoundError);
  });
});
