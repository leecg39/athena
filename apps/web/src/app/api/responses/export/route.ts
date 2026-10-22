import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { listResponses } from "@athena/core/analytics";
import { requireWorkspace } from "@/lib/workspace";
import { parseResponsesState, responsesFilters } from "@/lib/responses-state";
import { csvRow } from "@/lib/csv";

const MAX_ROWS = 10_000;
const BATCH = 1_000;

/** CSV of the filtered answers (up to 10k rows). */
export async function GET(req: NextRequest) {
  const ws = await requireWorkspace();
  const state = parseResponsesState(Object.fromEntries(req.nextUrl.searchParams));
  const filters = responsesFilters(state);
  const lines = [csvRow(["date", "prompt", "topic", "model", "mentioned", "position", "sentiment", "cited", "sources", "top_domains", "competitors", "simulated"])];
  for (let offset = 0; offset < MAX_ROWS; offset += BATCH) {
    const { rows } = await listResponses(db, { actorId: ws.user.id, websiteId: ws.websiteId, filters, limit: BATCH, offset });
    for (const r of rows) {
      lines.push(
        csvRow([r.ranAt.toISOString(), r.promptText, r.topicName ?? "", r.model, r.mentioned, r.position ?? "", r.sentiment ?? "", r.cited, r.sourcesCount, r.topDomains.join(" "), r.competitors.join("; "), r.simulated]),
      );
    }
    if (rows.length < BATCH) break;
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="responses-${ws.website.domain}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
