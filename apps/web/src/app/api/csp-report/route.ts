import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import {
  getObservabilitySnapshot,
  MAX_CSP_BODY_BYTES,
  parseAndRecordCspReport,
} from "@/lib/telemetry";

/**
 * POST /api/csp-report
 * CSP violation report collector (`application/csp-report` and Reporting API `application/reports+json`).
 * Enforces 32KB payload bound and strips query parameters from reported URIs.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_CSP_BODY_BYTES) {
    return NextResponse.json({ error: "CSP report payload too large" }, { status: 413 });
  }
  if (!rawBody.trim()) {
    return new NextResponse(null, { status: 204 });
  }
  try {
    parseAndRecordCspReport(rawBody, req.headers.get("user-agent"));
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Invalid CSP report JSON" }, { status: 400 });
  }
}

/**
 * GET /api/csp-report
 * Returns recent sanitized CSP violation reports for authenticated users.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const snap = getObservabilitySnapshot();
  return NextResponse.json({
    data: snap.cspReports,
    total: snap.cspReports.length,
  });
}
