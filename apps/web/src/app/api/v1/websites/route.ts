import { NextRequest, NextResponse } from "next/server";
import { db, groups, websites } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { and, eq, isNull } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** POST /api/v1/websites — create/provision a website scoped to the API key's organization. */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;

  let body: { domain?: string; name?: string; groupId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawDomain = String(body.domain ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (!rawDomain || !rawDomain.includes(".") || rawDomain.length > 180) {
    return NextResponse.json({ error: "Valid domain is required" }, { status: 400 });
  }

  let validGroupId: string | null = null;
  if (body.groupId) {
    if (!UUID_RE.test(body.groupId)) {
      return NextResponse.json({ error: "Invalid groupId UUID" }, { status: 400 });
    }
    const [ownedGroup] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(
          eq(groups.id, body.groupId),
          eq(groups.organizationId, ctx.organizationId),
          isNull(groups.deletedAt),
        ),
      );
    if (!ownedGroup) {
      return NextResponse.json({ error: "Group not found in this organization" }, { status: 404 });
    }
    validGroupId = ownedGroup.id;
  }

  try {
    const [row] = await db
      .insert(websites)
      .values({
        organizationId: ctx.organizationId,
        domain: rawDomain,
        name: String(body.name ?? "").trim() || rawDomain,
        groupId: validGroupId,
      })
      .returning();
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
