import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { contentItems } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite, notYetAvailable } from "@/lib/api-website";
import { and, eq, desc } from "drizzle-orm";

/** GET /api/v1/content?websiteId=… — list tracked content items. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const site = await resolveApiWebsite(ctx, req.nextUrl.searchParams.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const websiteId = site.id;
  try {
    const rows = await db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, websiteId)))
      .orderBy(desc(contentItems.createdAt))
      .limit(200);
    return NextResponse.json({ data: rows });
  } catch {
    return NextResponse.json({ data: [], note: "database unavailable" });
  }
}

/** POST /api/v1/content — create a content item (idea) anchored to a prompt/topic. */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  return notYetAvailable("Creating content via the API");
}
