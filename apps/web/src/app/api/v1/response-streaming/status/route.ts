import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { runs } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { eq } from "drizzle-orm";

/** GET /api/v1/response-streaming?runId=… — poll run state and progress. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      data: {
        workflow_id: run.workflowId,
        state: run.state,
        progress: {
          percentage: run.totalResponses ? Math.round((run.completedResponses / run.totalResponses) * 100) : 0,
          completed: run.completedResponses,
          total: run.totalResponses,
        },
      },
    });
  } catch {
    return NextResponse.json({ error: "database unavailable" }, { status: 503 });
  }
}
