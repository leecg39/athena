import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, NotFoundError } from "@athena/core/org";

const h = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  createThread: vi.fn(),
  appendUserMessage: vi.fn(),
  claimRun: vi.fn(),
  releaseRun: vi.fn(),
  chatSetup: vi.fn(),
  answer: vi.fn(),
  askLimiter: vi.fn(() => ({ ok: true, retryAfterMs: 0 })),
  threadLimiter: vi.fn(() => ({ ok: true, retryAfterMs: 0 })),
}));

vi.mock("@athena/db", () => ({ db: { stub: true } }));
vi.mock("@/lib/workspace", () => ({ getWorkspace: h.getWorkspace }));
vi.mock("@/lib/assistant", () => ({ chatSetup: h.chatSetup }));
vi.mock("@/lib/limits", () => ({ askLimiter: h.askLimiter, threadLimiter: h.threadLimiter }));
vi.mock("@athena/core/assistant", () => ({
  createThread: h.createThread,
  appendUserMessage: h.appendUserMessage,
  claimRun: h.claimRun,
  releaseRun: h.releaseRun,
  historyForModel: (items: { role: "user" | "assistant"; content: string }[]) => items.map(({ role, content }) => ({ role, content })),
}));
vi.mock("@/lib/ask-run", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ask-run")>("@/lib/ask-run");
  return { ...actual, answer: h.answer };
});

import { POST } from "./route";

const ws = {
  user: { id: "11111111-1111-4000-8000-111111111111", name: "Demo", email: "demo@example.com", image: null },
  website: { id: "22222222-2222-4000-8000-222222222222", name: "Canvasly", domain: "canvasly.io", organizationId: "33333333-3333-4000-8000-333333333333" },
  websiteId: "22222222-2222-4000-8000-222222222222",
  organizationId: "33333333-3333-4000-8000-333333333333",
  sites: [],
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/athena/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getWorkspace.mockResolvedValue(ws);
  h.askLimiter.mockReturnValue({ ok: true, retryAfterMs: 0 });
  h.threadLimiter.mockReturnValue({ ok: true, retryAfterMs: 0 });
  h.chatSetup.mockResolvedValue({ system: "sys", tools: [] });
});

describe("POST /api/athena/chat", () => {
  it("blocks cross-origin and unauthenticated requests", async () => {
    const cross = await POST(post({ message: "hi" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(cross.status).toBe(403);

    h.getWorkspace.mockResolvedValueOnce(null);
    const unauth = await POST(post({ message: "hi" }));
    expect(unauth.status).toBe(401);
  });

  it("creates a new thread with attachments when threadId is omitted", async () => {
    h.createThread.mockResolvedValueOnce({
      thread: { id: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa", title: "How is my brand performing?" },
      message: { id: "m1", role: "user", content: "How is my brand performing?", attachments: [{ name: "notes.txt", type: "text/plain", size: 5, text: "hello" }] },
    });
    const res = await POST(post({ message: "How is my brand performing?", attachments: [{ name: "notes.txt", text: "hello" }] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ threadId: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa" });
    expect(h.createThread).toHaveBeenCalledWith(
      { stub: true },
      {
        actorId: ws.user.id,
        websiteId: ws.websiteId,
        message: "How is my brand performing?",
        attachments: [{ name: "notes.txt", text: "hello" }],
      },
    );
  });

  it("appends a follow-up message atomically inside claimRun and streams NDJSON events", async () => {
    const threadId = "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa";
    const claimedAt = new Date("2026-10-23T00:00:00Z");
    h.claimRun.mockResolvedValueOnce({
      thread: { id: threadId },
      claimedAt,
      history: [{ role: "user", content: "Compare competitors", attachments: [] }],
    });
    h.answer.mockImplementationOnce(async (_job: unknown, _signal: AbortSignal, send: (e: Record<string, unknown>) => void) => {
      send({ type: "provider", id: "simulated", simulated: true });
      send({ type: "text", delta: "Figma leads." });
      send({ type: "done", stored: true });
    });

    const res = await POST(post({ threadId, message: "Compare competitors", searchConsole: false }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(events).toEqual([
      { type: "provider", id: "simulated", simulated: true },
      { type: "text", delta: "Figma leads." },
      { type: "done", stored: true },
    ]);
    expect(h.claimRun).toHaveBeenCalledWith(
      { stub: true },
      {
        actorId: ws.user.id,
        websiteId: ws.websiteId,
        threadId,
        message: "Compare competitors",
        attachments: undefined,
      },
    );
    expect(h.chatSetup).toHaveBeenCalledWith(ws, { searchConsole: false });
    expect(h.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId,
        claimedAt,
        system: "sys",
        turns: [{ role: "user", content: "Compare competitors" }],
      }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it("maps domain, not-found and rate-limit errors to HTTP statuses", async () => {
    h.threadLimiter.mockReturnValueOnce({ ok: false, retryAfterMs: 30_000 });
    expect((await POST(post({ message: "hi" }))).status).toBe(429);

    h.createThread.mockRejectedValueOnce(new DomainError("Only text files (TXT, MD, CSV, TSV, JSON) can be attached"));
    const badFile = await POST(post({ message: "hi", attachments: [{ name: "a.png", text: "x" }] }));
    expect(badFile.status).toBe(400);
    expect(await badFile.json()).toEqual({ error: "Only text files (TXT, MD, CSV, TSV, JSON) can be attached" });

    h.claimRun.mockRejectedValueOnce(new NotFoundError("Chat not found"));
    const missing = await POST(post({ threadId: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa" }));
    expect(missing.status).toBe(404);
  });
});
