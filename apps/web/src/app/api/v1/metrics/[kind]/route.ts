import { NextRequest, NextResponse } from "next/server";
import { authenticate, isResponse } from "@/lib/api-key";
import { demoCitationSeries, demoMentionSeries } from "@/lib/demo";

type MetricKind = "share-of-voice" | "mention-rate" | "citation-rate" | "position";

/**
 * GET /api/v1/metrics/[kind]?websiteId=…&window=cumulative|over-time
 * Mirrors the observed metrics surface: cumulative + daily series for
 * share of voice, mention rate, citation rate and position.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const { kind } = await params;
  const windowMode = req.nextUrl.searchParams.get("window") ?? "cumulative";

  const mentionSeries = demoMentionSeries();
  const citationSeries = demoCitationSeries();

  const avg = (series: { brand: number }[]) => +(series.reduce((a, b) => a + b.brand, 0) / series.length).toFixed(2);

  switch (kind as MetricKind) {
    case "share-of-voice":
      return NextResponse.json({
        data:
          windowMode === "cumulative"
            ? { shareOfVoicePct: 47.8, relativeMentionRatePct: 58.3 }
            : mentionSeries.map((p) => ({ date: p.date, brand: p.brand, competitors: {} })),
      });
    case "mention-rate":
      return NextResponse.json({
        data:
          windowMode === "cumulative"
            ? { mentionRatePct: avg(mentionSeries), relativeMentionRatePct: avg(mentionSeries) * 1.22 }
            : mentionSeries,
      });
    case "citation-rate":
      return NextResponse.json({
        data:
          windowMode === "cumulative"
            ? { citationRatePct: avg(citationSeries) }
            : citationSeries,
      });
    case "position":
      return NextResponse.json({
        data: windowMode === "cumulative" ? { avgPosition: 1.8 } : [],
      });
    default:
      return NextResponse.json({ error: "unknown metric" }, { status: 404 });
  }
}
