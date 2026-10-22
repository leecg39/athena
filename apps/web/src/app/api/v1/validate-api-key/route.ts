import { NextRequest, NextResponse } from "next/server";
import { authenticate, isResponse } from "@/lib/api-key";

/** GET /api/v1/validate-api-key — validate a key and return org scope. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  return NextResponse.json({ valid: true, organizationId: ctx.organizationId });
}
