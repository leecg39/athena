import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { websites } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { and, eq, isNull } from "drizzle-orm";

/** GET /api/v1/websites — list websites (brands) in the org. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  try {
    const rows = await db
      .select()
      .from(websites)
      .where(and(eq(websites.organizationId, ctx.organizationId), isNull(websites.deletedAt)));
    return NextResponse.json({ data: rows });
  } catch {
    return NextResponse.json({ data: [], note: "database unavailable" });
  }
}

/** POST /api/v1/websites — create/provision a website. */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const body = (await req.json()) as { domain: string; name?: string; groupId?: string };
  try {
    const [row] = await db
      .insert(websites)
      .values({
        organizationId: ctx.organizationId,
        domain: body.domain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
        name: body.name ?? body.domain,
        groupId: body.groupId,
      })
      .returning();
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
