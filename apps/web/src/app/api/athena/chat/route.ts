import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { db } from "@athena/db";
import { claimRun, createThread, historyForModel, releaseRun } from "@athena/core/assistant";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import { getWorkspace } from "@/lib/workspace";
import { chatSetup } from "@/lib/assistant";
import { answer, ndjsonResponse } from "@/lib/ask-run";
import { askLimiter, threadLimiter } from "@/lib/limits";
import { assertSameOrigin, readJsonBody, RequestError } from "@/lib/request";

export const maxDuration = 120;

const MAX_BODY_BYTES = 2_000_000;

const attachmentSchema = z.object({
  name: z.string(),
  text: z.string(),
});

const bodySchema = z.object({
  threadId: z.string().optional(),
  message: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  searchConsole: z.boolean().optional(),
});

function errorResponse(err: unknown): Response {
  if (err instanceof RequestError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof DomainError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: { message: string }[] }).issues)) {
    const msg = (err as { issues: { message: string }[] }).issues.map((i) => i.message).join(", ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  console.error("[api/athena/chat]", err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/**
 * POST /api/athena/chat
 * - Without `threadId`: creates a new thread with the first user message (and attachments) and returns `{ threadId }` (201).
 * - With `threadId`: optionally appends a follow-up user message, claims the run, and streams NDJSON answer events.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    const ws = await getWorkspace();
    if (!ws) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const body = bodySchema.parse(await readJsonBody(req, MAX_BODY_BYTES));
    const actor = { actorId: ws.user.id, websiteId: ws.websiteId };

    if (!body.threadId) {
      const lim = threadLimiter(ws.user.id);
      if (!lim.ok) {
        return NextResponse.json(
          { error: "Too many new chats. Please wait a few minutes." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(lim.retryAfterMs / 1000)) } },
        );
      }
      const created = await createThread(db, {
        ...actor,
        message: body.message ?? "",
        attachments: body.attachments,
      });
      return NextResponse.json({ threadId: created.thread.id, thread: created.thread, message: created.message }, { status: 201 });
    }

    const lim = askLimiter(ws.user.id);
    if (!lim.ok) {
      return NextResponse.json(
        { error: "Ask Athena rate limit reached. Please wait a few minutes." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(lim.retryAfterMs / 1000)) } },
      );
    }

    const run = await claimRun(db, {
      ...actor,
      threadId: body.threadId,
      message: body.message,
      attachments: body.attachments,
    });
    let setup: Awaited<ReturnType<typeof chatSetup>>;
    try {
      setup = await chatSetup(ws, { searchConsole: body.searchConsole });
    } catch (err) {
      await releaseRun(db, { threadId: run.thread.id, claimedAt: run.claimedAt });
      throw err;
    }

    return ndjsonResponse(req, (signal, send) =>
      answer(
        {
          threadId: run.thread.id,
          claimedAt: run.claimedAt,
          system: setup.system,
          turns: historyForModel(run.history),
          tools: setup.tools,
        },
        signal,
        send,
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
