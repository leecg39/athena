import { db } from "@athena/db";
import { finishRun, releaseRun } from "@athena/core/assistant";
import { ChatUnavailableError, runChat, type ChatTool, type ChatTurn, type ToolCallSummary } from "@athena/llm/chat";

export const UNAVAILABLE = "Ask Athena needs an AI provider API key (or LLM_SIMULATED_PROVIDER=true in development).";

const TRUNCATED_NOTE = "\n\n_The answer was cut short because it reached the step or length limit._";
const REFUSED_NOTE = "_Athena declined to answer this request._";
const GENERIC_ERROR = "Athena could not finish answering right now. Try again in a moment.";

export interface AnswerJob {
  threadId: string;
  claimedAt: Date;
  system: string;
  turns: ChatTurn[];
  tools: ChatTool[];
}

export type SendEvent = (event: Record<string, unknown>) => void;

/**
 * Runs one assistant reply, streaming events and storing the finished or
 * user-stopped message in Postgres. Never leaks raw provider errors.
 */
export async function answer(job: AnswerJob, signal: AbortSignal, send: SendEvent): Promise<void> {
  let text = "";
  const toolCalls: ToolCallSummary[] = [];
  let provider: string | null = null;
  let simulated = false;

  try {
    const out = await runChat({ system: job.system, turns: job.turns, tools: job.tools, signal }, (e) => {
      if (e.type === "provider") {
        provider = e.id;
        simulated = e.simulated;
      } else if (e.type === "text") {
        text += e.delta;
      } else if (e.type === "tool" && (e.status === "done" || e.status === "error")) {
        toolCalls.push({ name: e.name, ok: e.status === "done" });
      }
      send(e);
    });

    let content = text || out.text;
    if (out.finish === "truncated") {
      send({ type: "text", delta: TRUNCATED_NOTE });
      content += TRUNCATED_NOTE;
    } else if (out.finish === "refused" && !content.trim()) {
      send({ type: "text", delta: REFUSED_NOTE });
      content = REFUSED_NOTE;
    }

    const stored = await finishRun(db, {
      threadId: job.threadId,
      claimedAt: job.claimedAt,
      reply: { content, toolCalls: out.toolCalls, provider: out.provider, simulated: out.simulated, status: "complete" },
    });
    send({ type: "done", stored });
  } catch (err) {
    if (signal.aborted) {
      if (text.trim()) {
        const stored = await finishRun(db, {
          threadId: job.threadId,
          claimedAt: job.claimedAt,
          reply: { content: text, toolCalls, provider, simulated, status: "stopped" },
        });
        send({ type: "done", stored });
      } else {
        await releaseRun(db, { threadId: job.threadId, claimedAt: job.claimedAt });
      }
      return;
    }
    console.error("[ask] answer failed", err);
    await releaseRun(db, { threadId: job.threadId, claimedAt: job.claimedAt });
    send({ type: "error", message: err instanceof ChatUnavailableError ? UNAVAILABLE : GENERIC_ERROR });
  }
}

/** Streams newline-delimited JSON events and aborts the run if the client disconnects. */
export function ndjsonResponse(req: Request, run: (signal: AbortSignal, send: SendEvent) => Promise<void>): Response {
  const ac = new AbortController();
  req.signal?.addEventListener("abort", () => ac.abort(), { once: true });
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: SendEvent = (event) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      run(ac.signal, send).finally(() => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      });
    },
    cancel() {
      closed = true;
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
