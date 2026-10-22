import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, kbPillars, kbFacts, oracleFindings } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite } from "@/lib/api-website";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/kb?websiteId=…&section=all|pillars|facts|oracle
 * Exposes Knowledge Base pillars, canonical brand facts, and Oracle accuracy findings.
 */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;

  const sp = req.nextUrl.searchParams;
  const site = await resolveApiWebsite(ctx, sp.get("websiteId"));
  if (site instanceof NextResponse) return site;

  const section = (sp.get("section") ?? "all").toLowerCase();

  try {
    const [pillars, facts, oracle] = await Promise.all([
      section === "all" || section === "pillars"
        ? db
            .select()
            .from(kbPillars)
            .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)))
            .orderBy(desc(kbPillars.createdAt))
        : Promise.resolve([]),
      section === "all" || section === "facts"
        ? db
            .select()
            .from(kbFacts)
            .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)))
            .orderBy(desc(kbFacts.createdAt))
        : Promise.resolve([]),
      section === "all" || section === "oracle"
        ? db
            .select()
            .from(oracleFindings)
            .where(eq(oracleFindings.websiteId, site.id))
            .orderBy(desc(oracleFindings.createdAt))
            .limit(100)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      data: {
        pillars,
        facts,
        oracleFindings: oracle,
      },
      meta: {
        websiteId: site.id,
        section,
        pillarsCount: pillars.length,
        factsCount: facts.length,
        oracleFindingsCount: oracle.length,
      },
    });
  } catch {
    return NextResponse.json(
      { data: { pillars: [], facts: [], oracleFindings: [] }, note: "database unavailable" },
      { status: 200 },
    );
  }
}

/**
 * POST /api/v1/kb
 * Creates a Knowledge Base pillar (`kind: "pillar"`) or canonical fact (`kind: "fact"`).
 */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;

  let body: {
    websiteId?: string;
    kind?: "pillar" | "fact";
    name?: string;
    document?: string;
    pillarId?: string;
    claim?: string;
    sourceUrl?: string;
    status?: "pending_review" | "confirmed" | "rejected";
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const site = await resolveApiWebsite(
    ctx,
    body.websiteId ?? req.nextUrl.searchParams.get("websiteId"),
  );
  if (site instanceof NextResponse) return site;

  const kind = body.kind === "pillar" ? "pillar" : "fact";

  if (kind === "pillar") {
    const name = String(body.name ?? "").trim();
    if (name.length < 2 || name.length > 160) {
      return NextResponse.json(
        { error: { code: "bad_request", message: "pillar name must be 2..160 characters" } },
        { status: 400 },
      );
    }
    const [created] = await db
      .insert(kbPillars)
      .values({
        websiteId: site.id,
        name,
        document: body.document ? String(body.document).trim() : null,
      })
      .returning();

    return NextResponse.json({ data: created }, { status: 201 });
  }

  const claim = String(body.claim ?? "").trim();
  if (claim.length < 5 || claim.length > 1000) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "fact claim must be 5..1000 characters" } },
      { status: 400 },
    );
  }

  let targetPillarId = body.pillarId?.trim() || "";
  if (targetPillarId) {
    if (!UUID_RE.test(targetPillarId)) {
      return NextResponse.json(
        { error: { code: "bad_request", message: "Invalid pillarId UUID" } },
        { status: 400 },
      );
    }
    const [existingPillar] = await db
      .select({ id: kbPillars.id })
      .from(kbPillars)
      .where(
        and(
          eq(kbPillars.id, targetPillarId),
          eq(kbPillars.websiteId, site.id),
          isNull(kbPillars.deletedAt),
        ),
      );
    if (!existingPillar) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Pillar not found in this website" } },
        { status: 404 },
      );
    }
  } else {
    // Find or create default API pillar for this website
    const [firstPillar] = await db
      .select({ id: kbPillars.id })
      .from(kbPillars)
      .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)))
      .limit(1);

    if (firstPillar) {
      targetPillarId = firstPillar.id;
    } else {
      const [createdPillar] = await db
        .insert(kbPillars)
        .values({
          websiteId: site.id,
          name: `${site.name} Core Brand Facts`,
          document: "Canonical brand facts created via REST API / MCP",
        })
        .returning({ id: kbPillars.id });
      targetPillarId = createdPillar!.id;
    }
  }

  const status =
    body.status === "confirmed" || body.status === "rejected"
      ? body.status
      : "pending_review";

  let normalizedSourceUrl: string | null = null;
  if (body.sourceUrl) {
    const rawUrl = String(body.sourceUrl).trim();
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json(
          { error: { code: "bad_request", message: "sourceUrl must use http:// or https://" } },
          { status: 400 },
        );
      }
      normalizedSourceUrl = parsed.toString();
    } catch {
      return NextResponse.json(
        { error: { code: "bad_request", message: "sourceUrl must be a valid HTTP(S) URL" } },
        { status: 400 },
      );
    }
  }

  const [createdFact] = await db
    .insert(kbFacts)
    .values({
      websiteId: site.id,
      pillarId: targetPillarId,
      claim,
      sourceUrl: normalizedSourceUrl,
      status,
    })
    .returning();

  return NextResponse.json({ data: createdFact }, { status: 201 });
}
