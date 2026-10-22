import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { prompts, topics } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { and, eq, isNull } from "drizzle-orm";

/** GET /api/v1/prompts?websiteId=… — list active prompts with topic names. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const websiteId = req.nextUrl.searchParams.get("websiteId");
  if (!websiteId) return NextResponse.json({ error: "websiteId required" }, { status: 400 });
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
  const body = (await req.json()) as {
    websiteId: string;
    prompts: { text: string; topic?: string; type?: "branded" | "non_branded" }[];
  };
  try {
    const created = [];
    for (const p of body.prompts) {
      let topicId: string | null = null;
      if (p.topic) {
        const [existing] = await db
          .select()
          .from(topics)
          .where(and(eq(topics.websiteId, body.websiteId), eq(topics.name, p.topic)))
          .limit(1);
        if (existing) {
          topicId = existing.id;
        } else {
          const [t] = await db.insert(topics).values({ websiteId: body.websiteId, name: p.topic }).returning();
          topicId = t.id;
        }
      }
      const [row] = await db
        .insert(prompts)
        .values({ websiteId: body.websiteId, text: p.text, topicId, type: p.type ?? "non_branded" })
        .returning();
      created.push(row);
    }
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
