import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { responsesForSite } from "@athena/core/analytics";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite } from "@/lib/api-website";

const DAY = 86_400_000;

function date(v: string | null, fallback: Date): Date | null {
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** GET /api/v1/responses?websiteId=&since=&until=&model=&limit=&offset= — answers of an owned website. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const sp = req.nextUrl.searchParams;
  const site = await resolveApiWebsite(ctx, sp.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const now = new Date();
  const from = date(sp.get("since"), new Date(now.getTime() - 30 * DAY));
  const to = date(sp.get("until"), now);
  if (!from || !to || from >= to) return NextResponse.json({ error: "since/until must be ISO dates with since < until" }, { status: 400 });
  const limit = Math.min(Math.max(Number.parseInt(sp.get("limit") ?? "100", 10) || 100, 1), 500);
  const offset = Math.max(Number.parseInt(sp.get("offset") ?? "0", 10) || 0, 0);
  const model = sp.get("model");
  const { rows, total } = await responsesForSite(db, site.id, { filters: { from, to, models: model ? [model] : undefined }, limit, offset });
  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      ran_at: r.ranAt,
      model: r.model,
      prompt_id: r.promptId,
      prompt: r.promptText,
      mentioned: r.mentioned,
      position: r.position,
      sentiment: r.sentiment,
      cited: r.cited,
      sources: r.sourcesCount,
      competitors: r.competitors,
      simulated: r.simulated,
    })),
    pagination: { total, limit, offset },
  });
}
