import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { responses, prompts, responseMentions, responseCitations } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { and, eq, gte, desc } from "drizzle-orm";

/** GET /api/v1/responses?websiteId=…&since=… — paginated AI responses with filters. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const websiteId = req.nextUrl.searchParams.get("websiteId");
  const since = req.nextUrl.searchParams.get("since");
  const model = req.nextUrl.searchParams.get("model");
  if (!websiteId) return NextResponse.json({ error: "websiteId required" }, { status: 400 });
  try {
    const rows = await db
      .select({
        id: responses.id,
        promptId: responses.promptId,
        promptText: prompts.text,
        model: responses.model,
        rawText: responses.rawText,
        mentioned: responses.mentioned,
        cited: responses.cited,
        position: responses.position,
        sentiment: responses.sentiment,
        ranAt: responses.ranAt,
      })
      .from(responses)
      .leftJoin(prompts, eq(prompts.id, responses.promptId))
      .where(
        and(
          eq(responses.websiteId, websiteId),
          ...(since ? [gte(responses.ranAt, new Date(since))] : []),
          ...(model ? [eq(responses.model, model)] : []),
        ),
      )
      .orderBy(desc(responses.ranAt))
      .limit(500);

    const ids = rows.map((r) => r.id);
    const mentions = ids.length
      ? await db.select().from(responseMentions).where(eq(responseMentions.responseId, ids[0]))
      : [];
    const citations = ids.length
      ? await db.select().from(responseCitations).where(eq(responseCitations.responseId, ids[0]))
      : [];

    return NextResponse.json({ data: rows, mentions: mentions.slice(0, 20), citations: citations.slice(0, 20) });
  } catch {
    return NextResponse.json({ data: [], note: "database unavailable" });
  }
}
