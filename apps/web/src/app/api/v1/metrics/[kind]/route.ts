import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { visibilityForSite } from "@athena/core/analytics";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite } from "@/lib/api-website";

const KINDS = ["share-of-voice", "mention-rate", "citation-rate", "position"] as const;
type Kind = (typeof KINDS)[number];
const DAY = 86_400_000;

/**
 * GET /api/v1/metrics/{share-of-voice|mention-rate|citation-rate|position}
 *   ?websiteId=&window=cumulative|over-time&since=&until=&model=
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const { kind } = await params;
  if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "unknown metric" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const site = await resolveApiWebsite(ctx, sp.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const now = new Date();
  const from = sp.get("since") ? new Date(sp.get("since")!) : new Date(now.getTime() - 30 * DAY);
  const to = sp.get("until") ? new Date(sp.get("until")!) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return NextResponse.json({ error: "since/until must be ISO dates with since < until" }, { status: 400 });
  }
  const model = sp.get("model");
  const m = await visibilityForSite(db, site, { from, to, models: model ? [model] : undefined });
  const field = { "share-of-voice": "shareOfVoice", "mention-rate": "mentionRate", "citation-rate": "citationRate", position: "avgPosition" } as const;
  const key = field[kind as Kind];
  if (sp.get("window") === "over-time") {
    return NextResponse.json({ data: m.daily.map((d) => ({ date: d.date, value: d[key], responses: d.responses })), meta: { from, to, timezone: site.timezone } });
  }
  return NextResponse.json({
    data: { value: m.totals[key], responses: m.totals.responses, ...(kind === "share-of-voice" ? { entities: m.entities } : {}) },
    meta: { from, to },
  });
}
