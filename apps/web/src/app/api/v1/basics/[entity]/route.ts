import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { topics, competitors, personas, locations } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite } from "@/lib/api-website";
import { and, eq, isNull } from "drizzle-orm";

/**
 * GET /api/v1/basics/[entity]?websiteId=…
 * Topics / competitors / personas / locations in one grouped surface
 * (mirrors observed basics endpoints).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const { entity } = await params;
  const site = await resolveApiWebsite(ctx, req.nextUrl.searchParams.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const websiteId = site.id;
  try {
    switch (entity) {
      case "topics":
        return NextResponse.json({ data: await db.select().from(topics).where(and(eq(topics.websiteId, websiteId), isNull(topics.deletedAt))) });
      case "competitors":
        return NextResponse.json({ data: await db.select().from(competitors).where(and(eq(competitors.websiteId, websiteId), isNull(competitors.deletedAt))) });
      case "personas":
        return NextResponse.json({ data: await db.select().from(personas).where(and(eq(personas.websiteId, websiteId), isNull(personas.deletedAt))) });
      case "locations":
        return NextResponse.json({ data: await db.select().from(locations).where(and(eq(locations.websiteId, websiteId), isNull(locations.deletedAt))) });
      default:
        return NextResponse.json({ error: "unknown entity" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ data: [], note: "database unavailable" });
  }
}
