/**
 * Report delivery through real channels only: email via the configured
 * transport and Slack via the website's incoming webhook. A report counts as
 * sent only when at least one channel accepted it.
 */
import { and, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { type Db, activityLog, scheduledReports, websites } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError } from "../org/errors";
import { CADENCE_DAYS, toScheduledReportItem, type PublicReportData, type ScheduledReportItem } from "./catalog";
import { buildReportData } from "./data";
import { ownReport } from "./crud";
import { slackWebhookForSite } from "./slack";

export interface ReportEmail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

/** Outgoing channels provided by the server (null = not configured). */
export interface ReportTransport {
  email: ((message: ReportEmail) => Promise<void>) | null;
  slack: ((webhookUrl: string, text: string) => Promise<void>) | null;
}

export interface DeliveryResult {
  reportId: string;
  sentAt: Date;
  emailed: number;
  slackPosted: boolean;
  /** channels that were not used, and why */
  skipped: string[];
}

interface DeliveryOptions {
  /** the user who asked for the send; null for scheduled sends */
  actorId: string | null;
  transport: ReportTransport;
  secretKey: string;
  appUrl: string;
  now: Date;
}

const DAY = 86_400_000;
const GRACE = 10 * 60_000;
const fmt = (v: number | null, unit = "%") => (v === null ? "-" : `${v}${unit}`);
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 120);
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Slack mrkdwn control characters (so names cannot ping @channel or inject links) */
const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
/** Manual sends per website per day (scheduled sends are limited by their cadence). */
export const MANUAL_SENDS_PER_DAY = 20;

/** Plain-text summary shared by email, Slack and the PDF. */
export function reportSummaryLines(data: PublicReportData): string[] {
  const k = data.kpis;
  const lines = [`${data.name} — ${data.brandName} (${data.brandDomain})`, `Last ${data.period.days} days: ${k.responses} AI answers collected`];
  if (!k.responses) return [...lines, "No answers were collected in this period."];
  return [
    ...lines,
    `Mention rate: ${fmt(k.mentionRatePct)} · Citation rate: ${fmt(k.citationRatePct)} · Share of voice: ${fmt(k.shareOfVoicePct)} · Avg position: ${fmt(k.avgPosition, "")}`,
    ...(k.simulatedSharePct > 0 ? [`${k.simulatedSharePct}% of these answers are simulated (development data).`] : []),
    ...(data.topSources[0] ? [`Most cited domain: ${data.topSources[0].domain} (${data.topSources[0].citations})`] : []),
  ];
}

function emailFor(report: ScheduledReportItem, data: PublicReportData, url: string, now: Date): ReportEmail {
  const lines = reportSummaryLines(data);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p><a href="${escapeHtml(url)}">Open the full report</a></p></div>`;
  return { to: report.recipients, subject: oneLine(`${report.name} — ${data.brandName}`).slice(0, 200), html, text: [...lines, `Full report: ${url}`].join("\n"), idempotencyKey: `report-${report.id}-${now.toISOString()}` };
}

interface Outcome {
  delivered: number;
  note: string | null;
  failed: boolean;
}
const unused: Outcome = { delivered: 0, note: null, failed: false };
const skippedBecause = (note: string): Outcome => ({ delivered: 0, note, failed: false });

async function viaEmail(report: ScheduledReportItem, data: PublicReportData, url: string, opts: DeliveryOptions): Promise<Outcome> {
  if (!report.recipients.length) return unused;
  if (!opts.transport.email) return skippedBecause("Email delivery isn't configured on this server");
  try {
    await opts.transport.email(emailFor(report, data, url, opts.now));
    return { delivered: report.recipients.length, note: null, failed: false };
  } catch (err) {
    return { delivered: 0, note: `Email delivery failed (${reason(err)})`, failed: true };
  }
}

async function viaSlack(db: Db, site: WebsiteRow, report: ScheduledReportItem, data: PublicReportData, url: string, opts: DeliveryOptions): Promise<Outcome> {
  if (!report.slackChannel) return unused;
  const hook = await slackWebhookForSite(db, site.id, opts.secretKey);
  if (!hook) return skippedBecause("Slack isn't connected for this website");
  if (!opts.transport.slack) return skippedBecause("Slack delivery isn't available on this server");
  try {
    await opts.transport.slack(hook, [...reportSummaryLines(data).map(escapeSlack), `Full report: <${url}|open>`].join("\n"));
    return { delivered: 1, note: null, failed: false };
  } catch (err) {
    return { delivered: 0, note: `Slack delivery failed (${reason(err)})`, failed: true };
  }
}

async function deliver(db: Db, site: WebsiteRow, report: ScheduledReportItem, opts: DeliveryOptions): Promise<DeliveryResult> {
  const data = await buildReportData(db, site, report, opts.now);
  const url = `${opts.appUrl.replace(/\/+$/, "")}${report.sharePath}`;
  const email = await viaEmail(report, data, url, opts);
  const slack = await viaSlack(db, site, report, data, url, opts);
  const notes = [email, slack].filter((o) => o.note).sort((a, b) => Number(b.failed) - Number(a.failed)).map((o) => o.note as string);
  if (!email.delivered && !slack.delivered) {
    throw new DomainError(`Nothing was sent: ${notes.length ? notes.join("; ") : "add email recipients or a Slack channel first"}.`);
  }
  await db.update(scheduledReports).set({ lastSentAt: opts.now }).where(eq(scheduledReports.id, report.id));
  await logActivity(db, { organizationId: site.organizationId, userId: opts.actorId, websiteId: site.id, entityType: "scheduled_report", entityId: report.id, change: "dispatched", after: { emailed: email.delivered, slackPosted: slack.delivered > 0, notes, sentAt: opts.now.toISOString() } });
  return { reportId: report.id, sentAt: opts.now, emailed: email.delivered, slackPosted: slack.delivered > 0, skipped: notes };
}

export async function sendScheduledReportNow(
  db: Db,
  input: { actorId: string; websiteId: string; reportId: string; transport: ReportTransport; secretKey: string; appUrl: string },
): Promise<DeliveryResult> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const report = toScheduledReportItem(await ownReport(db, site.id, input.reportId));
  const [sent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(eq(activityLog.websiteId, site.id), eq(activityLog.entityType, "scheduled_report"), eq(activityLog.change, "dispatched"), isNotNull(activityLog.userId), gte(activityLog.createdAt, new Date(Date.now() - DAY))));
  if (Number(sent?.n ?? 0) >= MANUAL_SENDS_PER_DAY) throw new DomainError(`Reports for this website were sent ${MANUAL_SENDS_PER_DAY} times in the last 24 hours. Try again later.`);
  return deliver(db, site, report, { actorId: input.actorId, transport: input.transport, secretKey: input.secretKey, appUrl: input.appUrl, now: new Date() });
}

const isDue = (r: ScheduledReportItem, now: Date) => (r.lastSentAt ?? r.createdAt).getTime() + CADENCE_DAYS[r.cadence] * DAY - GRACE <= now.getTime();

/** Scheduled sends (cron): reports whose cadence has elapsed since the last send (or creation). */
export async function dispatchDueReports(
  db: Db,
  input: { now: Date; transport: ReportTransport; secretKey: string; appUrl: string; limit?: number },
): Promise<{ sent: string[]; failed: { reportId: string; error: string }[] }> {
  const cutoff = new Date(input.now.getTime() - DAY + GRACE);
  const rows = await db
    .select({ report: scheduledReports, site: websites })
    .from(scheduledReports)
    .innerJoin(websites, and(eq(websites.id, scheduledReports.websiteId), isNull(websites.deletedAt)))
    .where(lte(sql`coalesce(${scheduledReports.lastSentAt}, ${scheduledReports.createdAt})`, cutoff))
    .orderBy(sql`coalesce(${scheduledReports.lastSentAt}, ${scheduledReports.createdAt})`)
    .limit(input.limit ?? 25);
  const due = rows.map((r) => ({ site: r.site, report: toScheduledReportItem(r.report) })).filter((r) => isDue(r.report, input.now));
  // one report at a time, so a large backlog does not hit the email/Slack APIs in a burst
  const outcomes = await due.reduce<Promise<{ reportId: string; error: string | null }[]>>(async (acc, { site, report }) => {
    const done = await acc;
    try {
      await deliver(db, site, report, { actorId: null, transport: input.transport, secretKey: input.secretKey, appUrl: input.appUrl, now: input.now });
      return [...done, { reportId: report.id, error: null }];
    } catch (err) {
      return [...done, { reportId: report.id, error: reason(err) }];
    }
  }, Promise.resolve([]));
  return {
    sent: outcomes.filter((o) => o.error === null).map((o) => o.reportId),
    failed: outcomes.flatMap((o) => (o.error === null ? [] : [{ reportId: o.reportId, error: o.error }])),
  };
}
