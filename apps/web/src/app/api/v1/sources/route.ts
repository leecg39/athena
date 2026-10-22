import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { listSourcesForSite, SOURCE_TYPES, type SourceType } from "@athena/core/sources";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite } from "@/lib/api-website";

const DAY = 86_400_000;

/** GET /api/v1/sources?websiteId=&since=&until=&model=&type=&limit=&offset= — cited root domains. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const sp = req.nextUrl.searchParams;
  const site = await resolveApiWebsite(ctx, sp.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const now = new Date();
  const from = sp.get("since") ? new Date(sp.get("since")!) : new Date(now.getTime() - 30 * DAY);
  const to = sp.get("until") ? new Date(sp.get("until")!) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return NextResponse.json({ error: "since/until must be ISO dates with since < until" }, { status: 400 });
  }
  const type = sp.get("type");
  if (type && !SOURCE_TYPES.includes(type as SourceType)) return NextResponse.json({ error: `type must be one of ${SOURCE_TYPES.join(", ")}` }, { status: 400 });
  const limit = Math.min(Math.max(Number.parseInt(sp.get("limit") ?? "50", 10) || 50, 1), 500);
  const offset = Math.max(Number.parseInt(sp.get("offset") ?? "0", 10) || 0, 0);
  const model = sp.get("model");
  const r = await listSourcesForSite(db, site, { filters: { from, to, models: model ? [model] : undefined }, type: (type as SourceType) || undefined, limit, offset });
  return NextResponse.json({
    data: r.rows.map((s) => ({
      root_domain: s.rootDomain,
      default_source_type: s.type,
      response_count: s.responses,
      citation_percentage: s.citationPct,
      brand_mention_percentage: s.brandMentionPct,
      competitor_mention_percentage: s.competitorMentionPct,
      first_seen: s.firstSeen,
      daily_citation_percentage: s.spark,
    })),
    meta: { days: r.days, total_responses: r.totalResponses },
    pagination: { total: r.total, limit, offset },
  });
}
