import { NextRequest, NextResponse } from "next/server";

/** CSP violation report collector (mirrors observed /api/csp-report). */
export async function POST(_req: NextRequest) {
  return new NextResponse(null, { status: 204 });
}
