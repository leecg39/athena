import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db, websites } from "@athena/db";
import { DomainError } from "@athena/core/org";
import { planRun } from "@athena/jobs/collection";
import { configuredAdapters } from "@athena/llm/providers";
import { authenticate, isResponse } from "@/lib/api-key";
import { dispatchRun } from "@/lib/collection";

const Body = z.object({ websiteId: z.string().uuid(), promptIds: z.array(z.string().uuid()).max(500).optional() });

/** POST /api/v1/response-streaming — start a collection run for a website owned by the key's organization. */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body: websiteId (uuid) required" }, { status: 400 });
  const [site] = await db
    .select({ id: websites.id })
    .from(websites)
    .where(and(eq(websites.id, parsed.data.websiteId), eq(websites.organizationId, ctx.organizationId), isNull(websites.deletedAt)));
  if (!site) return NextResponse.json({ error: "website not found" }, { status: 404 });
  try {
    const run = await planRun(db, { websiteId: site.id, trigger: "api", promptIds: parsed.data.promptIds, adapters: configuredAdapters() });
    await dispatchRun(run.id);
    return NextResponse.json({ data: { workflow_id: run.id, state: run.state, total: run.totalResponses } }, { status: 202 });
  } catch (err) {
    if (err instanceof DomainError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
