"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  REPORT_CADENCES,
  REPORT_TYPES,
  type ReportCadence,
  type ReportType,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  sendScheduledReportNow,
} from "@athena/core/reports";
import { getSettingsContext } from "@/lib/settings-context";
import { integrationKey } from "@/lib/integrations";
import { reportLinkBase, reportTransport } from "@/lib/report-transport";
import { reportsLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = reportsLimiter(userId);
  if (!r.ok) {
    return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.` };
  }
  return null;
}

export async function createReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const name = String(formData.get("name") ?? "").trim();
    const rawType = String(formData.get("reportType") ?? "ai_search").trim();
    const reportType: ReportType = (REPORT_TYPES as readonly string[]).includes(rawType)
      ? (rawType as ReportType)
      : "ai_search";
    const rawCadence = String(formData.get("cadence") ?? "weekly").trim();
    const cadence: ReportCadence = (REPORT_CADENCES as readonly string[]).includes(rawCadence)
      ? (rawCadence as ReportCadence)
      : "weekly";
    const slackChannel = String(formData.get("slackChannel") ?? "").trim() || null;
    const rawRecipients = String(formData.get("recipients") ?? "").trim();
    const recipients = rawRecipients ? [rawRecipients] : [];
    const charts = formData.getAll("charts").map((c) => String(c));

    const created = await createScheduledReport(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      name,
      reportType,
      charts,
      recipients,
      cadence,
      slackChannel,
    });

    revalidatePath("/reports");
    return {
      ok: true,
      message: `Created "${created.name}" (${created.charts.length} charts · public share ${created.sharePath}).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to create scheduled report.");
  }
}

export async function updateReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const reportId = String(formData.get("reportId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const rawType = String(formData.get("reportType") ?? "ai_search").trim();
    const reportType: ReportType = (REPORT_TYPES as readonly string[]).includes(rawType)
      ? (rawType as ReportType)
      : "ai_search";
    const rawCadence = String(formData.get("cadence") ?? "weekly").trim();
    const cadence: ReportCadence = (REPORT_CADENCES as readonly string[]).includes(rawCadence)
      ? (rawCadence as ReportCadence)
      : "weekly";
    const slackChannel = String(formData.get("slackChannel") ?? "").trim() || null;
    const rawRecipients = String(formData.get("recipients") ?? "").trim();
    const recipients = rawRecipients ? [rawRecipients] : [];
    const charts = formData.getAll("charts").map((c) => String(c));

    const updated = await updateScheduledReport(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      reportId,
      name,
      reportType,
      charts,
      recipients,
      cadence,
      slackChannel,
    });

    revalidatePath("/reports");
    revalidatePath(`/report/${updated.shareId}`);
    revalidatePath(`/report/content/${updated.shareId}`);
    return {
      ok: true,
      message: `Saved chart composition & schedule for "${updated.name}".`,
    };
  } catch (err) {
    return toActionError(err, "Failed to update report.");
  }
}

export async function sendReportNowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const reportId = String(formData.get("reportId") ?? "").trim();
    const sent = await sendScheduledReportNow(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      reportId,
      transport: reportTransport(),
      secretKey: integrationKey(),
      appUrl: await reportLinkBase(),
    });

    revalidatePath("/reports");
    const main = sent.emailed && sent.slackPosted
      ? `Sent to ${sent.emailed} email recipient(s) and Slack.`
      : sent.emailed
        ? `Sent to ${sent.emailed} email recipient(s).`
        : "Posted to Slack.";
    return { ok: true, message: sent.skipped.length ? `${main} Not sent: ${sent.skipped.join("; ")}.` : main };
  } catch (err) {
    return toActionError(err, "Failed to send report.");
  }
}

export async function deleteReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const reportId = String(formData.get("reportId") ?? "").trim();
    await deleteScheduledReport(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      reportId,
    });

    revalidatePath("/reports");
    return {
      ok: true,
      message: "Deleted scheduled report.",
    };
  } catch (err) {
    return toActionError(err, "Failed to delete report.");
  }
}
