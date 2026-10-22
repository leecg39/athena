import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { prompts } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite, notYetAvailable } from "@/lib/api-website";
import { and, eq, isNull } from "drizzle-orm";

/** GET /api/v1/prompts?websiteId=… — list active prompts with topic names. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const site = await resolveApiWebsite(ctx, req.nextUrl.searchParams.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const websiteId = site.id;
  try {
    const rows = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.websiteId, websiteId), eq(prompts.status, "active"), isNull(prompts.deletedAt)));
    return NextResponse.json({ data: rows });
  } catch {
    return NextResponse.json({ data: [], note: "database unavailable" });
  }
}

/** POST /api/v1/prompts — create prompts (get-or-create topic by name). */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  // writes must go through plan limits, de-duplication and the audit log (rebuilt with the v1 write API)
  return notYetAvailable("Creating prompts via the API");
}
