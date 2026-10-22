import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { contentItems, prompts, topics } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { and, eq, desc } from "drizzle-orm";

/** GET /api/v1/content?websiteId=… — list tracked content items. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const websiteId = req.nextUrl.searchParams.get("websiteId");
  if (!websiteId) return NextResponse.json({ error: "websiteId required" }, { status: 400 });
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
  const body = (await req.json()) as { websiteId: string; title: string; promptId?: string };
  try {
    let topicName: string | null = null;
    if (body.promptId) {
      const [p] = await db.select().from(prompts).where(eq(prompts.id, body.promptId)).limit(1);
      if (p?.topicId) {
        const [t] = await db.select().from(topics).where(eq(topics.id, p.topicId)).limit(1);
        topicName = t?.name ?? null;
      }
    }
    const [row] = await db
      .insert(contentItems)
      .values({
        websiteId: body.websiteId,
        title: body.title,
        promptId: body.promptId,
        status: "idea",
        columns: topicName ? { topic: topicName } : {},
      })
      .returning();
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
