import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchDueSchedules } from "@athena/jobs";
import { dispatchRun, inngestEnabled } from "@/lib/collection";

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel Cron fallback for schedule dispatch when Inngest is not configured. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (inngestEnabled()) return NextResponse.json({ skipped: "inngest handles schedules" });
  return NextResponse.json(await dispatchDueSchedules(dispatchRun));
}
