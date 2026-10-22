import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  send: vi.fn<(e: unknown) => Promise<void>>(),
  reanalyze: vi.fn<(db: unknown, input: { websiteId: string }) => Promise<number>>(async () => 0),
  queue: [] as (() => Promise<void>)[],
}));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void h.queue.push(fn) }));
vi.mock("@athena/jobs", () => ({ inngest: { send: (e: unknown) => h.send(e) } }));
vi.mock("@athena/jobs/collection", () => ({ executeRun: vi.fn(), reanalyzeResponses: (db: unknown, input: { websiteId: string }) => h.reanalyze(db, input) }));
vi.mock("@athena/db", () => ({ db: { stub: true } }));
vi.mock("@athena/llm/providers", () => ({ configuredAdapters: () => [] }));

import { scheduleReanalysis } from "./collection";

const SITE = "1c54b139-561b-41a3-a76f-caeed7bdc5b4";

describe("scheduleReanalysis", () => {
  beforeEach(() => {
    h.queue.length = 0;
    h.send.mockReset();
    h.reanalyze.mockClear();
  });
  afterEach(() => {
    delete process.env.INNGEST_DEV;
    vi.restoreAllMocks();
  });

  it("queues an Inngest event when Inngest is configured", async () => {
    process.env.INNGEST_DEV = "1";
    h.send.mockResolvedValue(undefined);
    await scheduleReanalysis(SITE);
    expect(h.send).toHaveBeenCalledWith({ name: "website/reanalyze", data: { websiteId: SITE } });
    expect(h.queue).toHaveLength(0);
  });

  it("falls back to in-process re-analysis when the event cannot be queued", async () => {
    process.env.INNGEST_DEV = "1";
    h.send.mockRejectedValue(new Error("inngest unreachable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(scheduleReanalysis(SITE)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(h.queue).toHaveLength(1);
    await h.queue[0]();
    expect(h.reanalyze).toHaveBeenCalledWith({ stub: true }, { websiteId: SITE });
  });

  it("runs in-process after the response when Inngest is not configured", async () => {
    await scheduleReanalysis(SITE);
    expect(h.send).not.toHaveBeenCalled();
    await h.queue[0]();
    expect(h.reanalyze).toHaveBeenCalledTimes(1);
  });
});
