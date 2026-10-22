import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, runs, websites } from "@athena/db";
import { getRunProgress } from "@athena/jobs/collection";
import { authenticate, isResponse } from "@/lib/api-key";

/** GET /api/v1/response-streaming/status?workflow_id=… — progress of a run owned by the key's organization. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const runId = req.nextUrl.searchParams.get("workflow_id") ?? req.nextUrl.searchParams.get("runId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ error: "workflow_id required" }, { status: 400 });
  const [owned] = await db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(websites, eq(websites.id, runs.websiteId))
    .where(and(eq(runs.id, runId), eq(websites.organizationId, ctx.organizationId)));
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  const p = await getRunProgress(db, runId);
  return NextResponse.json({
    data: {
      workflow_id: p.id,
      state: p.state,
      progress: { percentage: p.percent, completed: p.succeeded + p.failed, succeeded: p.succeeded, failed: p.failed, total: p.total },
      credits: { reserved: p.creditsReserved, refunded: p.creditsRefunded },
    },
  });
}
