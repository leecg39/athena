import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { getVisibilityMetrics, parseDashboardState, stateToFilters } from "@athena/core/analytics";
import { ForbiddenError } from "@athena/core/org";
import { requireWorkspace } from "@/lib/workspace";
import { csvRow } from "@/lib/csv";

export async function GET(req: NextRequest) {
  const ws = await requireWorkspace();
  const state = parseDashboardState(Object.fromEntries(req.nextUrl.searchParams));
  try {
    const m = await getVisibilityMetrics(db, { actorId: ws.user.id, websiteId: ws.websiteId, filters: stateToFilters(state).current });
    const lines = [
      csvRow(["date", "answers", "mention_rate_pct", "citation_rate_pct", "avg_position", "share_of_voice_pct"]),
      ...m.daily.map((d) => csvRow([d.date, d.responses, d.mentionRate, d.citationRate, d.avgPosition ?? "", d.shareOfVoice])),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="olympus-${ws.website.domain}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw err;
  }
}
