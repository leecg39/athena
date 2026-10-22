import { NextRequest, NextResponse } from "next/server";
import { db, contentItems, prompts } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite } from "@/lib/api-website";
import { and, eq, desc, isNull } from "drizzle-orm";
import { CONTENT_STATUSES, type ContentStatus, normalizeContentUrl, slugify } from "@athena/core/content";
import { DomainError } from "@athena/core/org";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/v1/content?websiteId=… — list active (non-deleted) content items. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const site = await resolveApiWebsite(ctx, req.nextUrl.searchParams.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const websiteId = site.id;
  try {
    const rows = await db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, websiteId), isNull(contentItems.deletedAt)))
      .orderBy(desc(contentItems.createdAt))
      .limit(200);
    return NextResponse.json({
      data: rows.filter((r) => (r.columns ?? {}).catalogProduct !== true),
    });
  } catch {
    return NextResponse.json({ data: [], note: "database unavailable" });
  }
}

/** POST /api/v1/content — create a content item anchored to a website/prompt. */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;

  let body: { websiteId?: string; title?: string; targetUrl?: string; promptId?: string; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Invalid JSON body" } }, { status: 400 });
  }

  const site = await resolveApiWebsite(ctx, body.websiteId ?? req.nextUrl.searchParams.get("websiteId"));
  if (site instanceof NextResponse) return site;

  const title = String(body.title ?? "").trim();
  if (title.length < 3 || title.length > 220) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "title must be between 3 and 220 characters" } },
      { status: 400 },
    );
  }

  try {
    const targetUrl =
      body.targetUrl !== undefined
        ? normalizeContentUrl(body.targetUrl, site.domain)
        : `https://${site.domain}/blog/${slugify(title)}`;
    const status: ContentStatus =
      body.status && (CONTENT_STATUSES as readonly string[]).includes(body.status)
        ? (body.status as ContentStatus)
        : "idea";

    let validPromptId: string | null = null;
    if (body.promptId) {
      if (!UUID_RE.test(body.promptId)) {
        return NextResponse.json({ error: { code: "bad_request", message: "Invalid promptId" } }, { status: 400 });
      }
      const [p] = await db
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.id, body.promptId), eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
      if (!p) {
        return NextResponse.json(
          { error: { code: "not_found", message: "Prompt not found in this website" } },
          { status: 404 },
        );
      }
      validPromptId = p.id;
    }

    const [created] = await db
      .insert(contentItems)
      .values({
        websiteId: site.id,
        title,
        targetUrl,
        promptId: validPromptId,
        status,
        columns: { contentType: "Article", targetKeyword: title.toLowerCase(), agentStage: "idle" },
      })
      .returning();

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: { code: "bad_request", message: err.message } }, { status: 400 });
    }
    return NextResponse.json({ error: { code: "internal_error", message: "Failed to create content item" } }, { status: 500 });
  }
}
