import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  finishRun: vi.fn(async (_db: unknown, _input: Record<string, any>) => true),
  releaseRun: vi.fn(async (_db: unknown, _input: Record<string, any>) => {}),
  runChat: vi.fn(),
}));
vi.mock("@athena/db", () => ({ db: { stub: true } }));
vi.mock("@athena/core/assistant", () => ({ finishRun: h.finishRun, releaseRun: h.releaseRun }));
vi.mock("@athena/llm/chat", async () => {
  class ChatUnavailableError extends Error {}
  return { ChatUnavailableError, runChat: h.runChat };
});

import { answer, ndjsonResponse, UNAVAILABLE } from "./ask-run";
import { ChatUnavailableError } from "@athena/llm/chat";

const job = { threadId: "t1", claimedAt: new Date("2026-10-23T00:00:00Z"), system: "s", turns: [{ role: "user" as const, content: "q" }], tools: [] };
type Emit = (e: Record<string, unknown>) => void;

beforeEach(() => {
  h.finishRun.mockClear();
  h.releaseRun.mockClear();
  h.runChat.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("answer", () => {
  it("stores the streamed reply and reports done", async () => {
    h.runChat.mockImplementation(async (_req: unknown, emit: Emit) => {
      emit({ type: "provider", id: "anthropic", simulated: false });
      emit({ type: "text", delta: "Hello" });
      return { text: "Hello", toolCalls: [{ name: "get_visibility_metrics", ok: true }], finish: "truncated", provider: "anthropic", simulated: false };
    });
    const sent: Record<string, unknown>[] = [];
    await answer(job, new AbortController().signal, (e) => sent.push(e));
    const reply = h.finishRun.mock.calls[0][1].reply;
    expect(reply).toMatchObject({ provider: "anthropic", simulated: false, status: "complete", toolCalls: [{ name: "get_visibility_metrics", ok: true }] });
    expect(reply.content).toMatch(/^Hello\n\n_The answer was cut short/);
    // what was streamed equals what was stored
    expect(sent.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe(reply.content);
    expect(sent.at(-1)).toEqual({ type: "done", stored: true });
  });

  it("keeps a stopped partial answer and releases an empty one", async () => {
    const ac = new AbortController();
    h.runChat.mockImplementation(async (_req: unknown, emit: Emit) => {
      emit({ type: "provider", id: "simulated", simulated: true });
      emit({ type: "text", delta: "Partial" });
      emit({ type: "tool", name: "top_sources", status: "done" });
      ac.abort();
      throw new Error("aborted");
    });
    const sent: Record<string, unknown>[] = [];
    await answer(job, ac.signal, (e) => sent.push(e));
    expect(h.finishRun.mock.calls[0][1].reply).toEqual({ content: "Partial", toolCalls: [{ name: "top_sources", ok: true }], provider: "simulated", simulated: true, status: "stopped" });
    expect(sent.some((e) => e.type === "error")).toBe(false);

    const ac2 = new AbortController();
    h.runChat.mockImplementation(async () => {
      ac2.abort();
      throw new Error("aborted");
    });
    await answer(job, ac2.signal, () => {});
    expect(h.releaseRun).toHaveBeenCalledWith({ stub: true }, { threadId: "t1", claimedAt: job.claimedAt });
  });

  it("releases the run and reports a generic error on failure", async () => {
    h.runChat.mockRejectedValueOnce(new Error("upstream 500 with secret details"));
    const sent: Record<string, unknown>[] = [];
    await answer(job, new AbortController().signal, (e) => sent.push(e));
    expect(h.releaseRun).toHaveBeenCalledTimes(1);
    expect(h.finishRun).not.toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({ type: "error", message: expect.not.stringContaining("secret") });
    h.runChat.mockRejectedValueOnce(new ChatUnavailableError());
    const sent2: Record<string, unknown>[] = [];
    await answer(job, new AbortController().signal, (e) => sent2.push(e));
    expect(sent2.at(-1)).toEqual({ type: "error", message: UNAVAILABLE });
  });
});

describe("ndjsonResponse", () => {
  it("streams one JSON event per line and aborts the run when the reader cancels", async () => {
    let seen: AbortSignal | null = null;
    const res = ndjsonResponse(new Request("http://x/"), async (signal, send) => {
      seen = signal;
      send({ type: "text", delta: "a" });
      send({ type: "done" });
    });
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect((await res.text()).trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ type: "text", delta: "a" }, { type: "done" }]);
    let waiting: AbortSignal | null = null;
    const slow = ndjsonResponse(new Request("http://x/"), (signal) => {
      waiting = signal;
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
    });
    await slow.body!.cancel();
    expect((waiting as AbortSignal | null)?.aborted).toBe(true);
    expect((seen as AbortSignal | null)?.aborted).toBe(false);
  });
});
