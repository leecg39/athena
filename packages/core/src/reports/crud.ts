/** Scheduled reports a team creates (nothing is created on view). */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { type Db, scheduledReports } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import {
  REPORT_CADENCES,
  REPORT_TYPES,
  generateShareId,
  normalizeCharts,
  normalizeRecipients,
  normalizeSlackChannel,
  toScheduledReportItem,
  type ReportCadence,
  type ReportType,
  type ScheduledReportItem,
} from "./catalog";

const MAX_REPORTS = 50;

export async function listScheduledReports(db: Db, input: { actorId: string; websiteId: string }): Promise<ScheduledReportItem[]> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const rows = await db.select().from(scheduledReports).where(eq(scheduledReports.websiteId, site.id)).orderBy(desc(scheduledReports.createdAt), desc(scheduledReports.id));
  return rows.map(toScheduledReportItem);
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Report name is required").max(160),
  reportType: z.enum(REPORT_TYPES).default("ai_search"),
  charts: z.array(z.string()).min(1, "Select at least one chart module"),
  recipients: z.array(z.string()).default([]),
  cadence: z.enum(REPORT_CADENCES).default("weekly"),
  slackChannel: z.string().trim().nullable().optional(),
});

export async function createScheduledReport(
  db: Db,
  input: { actorId: string; websiteId: string } & z.input<typeof createSchema>,
): Promise<ScheduledReportItem> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid report configuration");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const charts = normalizeCharts(parsed.data.charts);
  if (!charts.length) throw new DomainError("Select at least one valid chart module");
  const values = {
    websiteId: site.id,
    name: parsed.data.name,
    shareId: generateShareId(parsed.data.reportType === "content_proposal" ? "cpr" : "rpt"),
    reportType: parsed.data.reportType,
    charts,
    recipients: normalizeRecipients(parsed.data.recipients),
    cadence: parsed.data.cadence,
    slackChannel: normalizeSlackChannel(parsed.data.slackChannel),
  };
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: scheduledReports.id }).from(scheduledReports).where(eq(scheduledReports.websiteId, site.id)).limit(MAX_REPORTS);
    if (existing.length >= MAX_REPORTS) throw new DomainError(`A website can have at most ${MAX_REPORTS} scheduled reports`);
    const [row] = await tx.insert(scheduledReports).values(values).returning();
    await logActivity(tx, { organizationId: site.organizationId, websiteId: site.id, userId: input.actorId, entityType: "scheduled_report", entityId: row!.id, change: "created", after: { name: values.name, reportType: values.reportType, charts: charts.length, recipients: values.recipients.length, slackChannel: values.slackChannel } });
    return toScheduledReportItem(row!);
  });
}

async function ownReport(db: Db, websiteId: string, reportId: string) {
  if (!z.string().uuid().safeParse(reportId).success) throw new DomainError("Invalid report ID");
  const [row] = await db.select().from(scheduledReports).where(and(eq(scheduledReports.id, reportId), eq(scheduledReports.websiteId, websiteId)));
  if (!row) throw new NotFoundError("Report not found");
  return row;
}

export async function updateScheduledReport(
  db: Db,
  input: { actorId: string; websiteId: string; reportId: string; name?: string; reportType?: ReportType; charts?: string[]; recipients?: string[]; cadence?: ReportCadence; slackChannel?: string | null },
): Promise<ScheduledReportItem> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const existing = toScheduledReportItem(await ownReport(db, site.id, input.reportId));
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (name.length < 2 || name.length > 160) throw new DomainError("Report name must be between 2 and 160 characters");
  const charts = input.charts !== undefined ? normalizeCharts(input.charts) : existing.charts;
  if (!charts.length) throw new DomainError("Select at least one chart module");
  const next = {
    name,
    reportType: input.reportType && (REPORT_TYPES as readonly string[]).includes(input.reportType) ? input.reportType : existing.reportType,
    charts,
    recipients: input.recipients !== undefined ? normalizeRecipients(input.recipients) : existing.recipients,
    cadence: input.cadence && (REPORT_CADENCES as readonly string[]).includes(input.cadence) ? input.cadence : existing.cadence,
    slackChannel: input.slackChannel !== undefined ? normalizeSlackChannel(input.slackChannel) : existing.slackChannel,
  };
  const [row] = await db.update(scheduledReports).set(next).where(and(eq(scheduledReports.id, existing.id), eq(scheduledReports.websiteId, site.id))).returning();
  await logActivity(db, { organizationId: site.organizationId, websiteId: site.id, userId: input.actorId, entityType: "scheduled_report", entityId: existing.id, change: "updated", after: { ...next, recipients: next.recipients.length } });
  return toScheduledReportItem(row!);
}

export async function deleteScheduledReport(db: Db, input: { actorId: string; websiteId: string; reportId: string }): Promise<void> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const existing = await ownReport(db, site.id, input.reportId);
  await db.delete(scheduledReports).where(and(eq(scheduledReports.id, existing.id), eq(scheduledReports.websiteId, site.id)));
  await logActivity(db, { organizationId: site.organizationId, websiteId: site.id, userId: input.actorId, entityType: "scheduled_report", entityId: existing.id, change: "deleted", before: { name: existing.name } });
}

export { ownReport };
