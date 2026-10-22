import { NextRequest, NextResponse } from "next/server";
import { authenticate, isResponse } from "@/lib/api-key";
import { startCollection } from "@athena/jobs";

/** POST /api/v1/response-streaming — start a collection run (1 credit per response). */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const body = (await req.json()) as { websiteId: string; promptIds?: string[] };
  if (!body.websiteId) return NextResponse.json({ error: "websiteId required" }, { status: 400 });
  try {
    const runId = await startCollection(body.websiteId, body.promptIds);
    return NextResponse.json({ data: { workflow_id: runId, state: "queued" } }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
