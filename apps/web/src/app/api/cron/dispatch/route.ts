import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@athena/db";
import { dispatchDueSchedules } from "@athena/jobs";
import { dispatchDueReports } from "@athena/core/reports";
import { dispatchRun, inngestEnabled } from "@/lib/collection";
import { integrationKey } from "@/lib/integrations";
import { reportLinkBase, reportTransport } from "@/lib/report-transport";

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel Cron: collection schedules (when Inngest is not configured) and scheduled report delivery. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const collection = inngestEnabled() ? { skipped: "inngest handles schedules" } : await dispatchDueSchedules(dispatchRun);
  const appUrl = await reportLinkBase().catch(() => null);
  if (!appUrl) return NextResponse.json({ collection, reports: { skipped: "NEXT_PUBLIC_APP_URL is not set" } });
  const reports = await dispatchDueReports(db, { now: new Date(), transport: reportTransport(), secretKey: integrationKey(), appUrl, limit: 10 });
  return NextResponse.json({ collection, reports: { sent: reports.sent.length, failed: reports.failed.length } });
}
