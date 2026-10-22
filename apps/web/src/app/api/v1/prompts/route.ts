import { NextRequest, NextResponse } from "next/server";
import { db, prompts, topics } from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite } from "@/lib/api-website";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  cleanPromptText,
  defaultScheduleId,
  isBrandedPrompt,
  lockWebsite,
  promptLimitFor,
} from "@athena/core/prompts";
import { DomainError } from "@athena/core/org";

/** GET /api/v1/prompts?websiteId=… — list active prompts with topic names. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const site = await resolveApiWebsite(ctx, req.nextUrl.searchParams.get("websiteId"));
  if (site instanceof NextResponse) return site;
  const websiteId = site.id;
  try {
    const rows = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.websiteId, websiteId), eq(prompts.status, "active"), isNull(prompts.deletedAt)));
    return NextResponse.json({ data: rows });
  } catch {
    return NextResponse.json({ data: [], note: "database unavailable" });
  }
}

/** POST /api/v1/prompts — create a prompt with plan-limit enforcement, website lock, and deduplication. */
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;

  let body: { websiteId?: string; text?: string; topicName?: string; volumeEstimate?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Invalid JSON body" } }, { status: 400 });
  }

  const site = await resolveApiWebsite(ctx, body.websiteId ?? req.nextUrl.searchParams.get("websiteId"));
  if (site instanceof NextResponse) return site;

  const text = cleanPromptText(String(body.text ?? ""));
  if (text.length < 5 || text.length > 500) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Prompt text must be between 5 and 500 characters" } },
      { status: 400 },
    );
  }

  try {
    const created = await db.transaction(async (tx) => {
      await lockWebsite(tx, site.id);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(prompts)
        .where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
      const limit = await promptLimitFor(tx, site.organizationId);
      if ((count?.n ?? 0) >= limit) {
        throw new DomainError(`Prompt limit reached: your plan allows ${limit} tracked prompts per website`);
      }

      const [dup] = await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(
          and(
            eq(prompts.websiteId, site.id),
            isNull(prompts.deletedAt),
            sql`lower(${prompts.text}) = lower(${text})`,
          ),
        );
      if (dup) {
        throw new DomainError("This prompt is already tracked");
      }

      let topicId: string | null = null;
      const topicName = String(body.topicName ?? "").trim();
      if (topicName.length >= 2 && topicName.length <= 80) {
        const [existingTopic] = await tx
          .select({ id: topics.id })
          .from(topics)
          .where(
            and(
              eq(topics.websiteId, site.id),
              isNull(topics.deletedAt),
              sql`lower(${topics.name}) = lower(${topicName})`,
            ),
          );
        if (existingTopic) {
          topicId = existingTopic.id;
        } else {
          const [newTopic] = await tx
            .insert(topics)
            .values({ websiteId: site.id, name: topicName })
            .returning({ id: topics.id });
          topicId = newTopic!.id;
        }
      }

      const scheduleId = await defaultScheduleId(tx, site.id);
      const [row] = await tx
        .insert(prompts)
        .values({
          websiteId: site.id,
          text,
          type: isBrandedPrompt(text, site.name, site.domain) ? "branded" : "non_branded",
          topicId,
          scheduleId,
          volumeEstimate: Math.max(0, Math.floor(Number(body.volumeEstimate ?? 0) || 0)),
        })
        .returning();

      return row!;
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: { code: "bad_request", message: err.message } }, { status: 400 });
    }
    return NextResponse.json({ error: { code: "internal_error", message: "Failed to create prompt" } }, { status: 500 });
  }
}
