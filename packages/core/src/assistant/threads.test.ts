import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { chatMessages } from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import { createThread, appendUserMessage, getThread, listThreads, renameThread, deleteThread, claimRun, finishRun, releaseRun, historyForModel, CHAT_LIMITS } from "./threads";

let t: TestDb;
let c: { actorId: string; websiteId: string };
let other: { actorId: string; websiteId: string };

beforeAll(async () => {
  t = await createTestDb();
  const u = await ensureUserWithOrg(t.db, { email: "chat@example.com" });
  const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
  c = { actorId: u.user.id, websiteId: site.id };
  const o = await ensureUserWithOrg(t.db, { email: "chat-other@example.com" });
  const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
  other = { actorId: o.user.id, websiteId: oSite.id };
});
afterAll(async () => {
  await t.close();
});

describe("chat threads", () => {
  it("creates a thread with the first message and validates input", async () => {
    const { thread, message } = await createThread(t.db, { ...c, message: "  How is my brand doing in AI answers this month?  ", attachments: [{ name: "keywords.csv", text: "query,volume\nai design,100" }] });
    expect(thread.title).toBe("How is my brand doing in AI answers this month?");
    expect(message).toMatchObject({ role: "user", content: "How is my brand doing in AI answers this month?" });
    expect(message.attachments).toEqual([{ name: "keywords.csv", type: "text/csv", size: 26, text: "query,volume\nai design,100" }]);
    await expect(createThread(t.db, { ...c, message: "   " })).rejects.toThrow();
    await expect(createThread(t.db, { ...c, message: "x".repeat(CHAT_LIMITS.messageChars + 1) })).rejects.toThrow();
    await expect(createThread(t.db, { ...c, message: "hi", attachments: [{ name: "evil.exe", text: "MZ" }] })).rejects.toThrow(/text files/i);
    await expect(createThread(t.db, { ...c, message: "hi", attachments: [{ name: "bin.csv", text: "a\u0000b" }] })).rejects.toThrow(/binary/i);
    await expect(createThread(t.db, { ...c, message: "hi", attachments: Array.from({ length: CHAT_LIMITS.attachments + 1 }, (_, i) => ({ name: `f${i}.txt`, text: "x" })) })).rejects.toThrow();
    // another organization cannot chat about this website
    await expect(createThread(t.db, { actorId: other.actorId, websiteId: c.websiteId, message: "hi" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps threads private to their owner and website", async () => {
    const { thread } = await createThread(t.db, { ...c, message: "Private question" });
    await expect(getThread(t.db, { actorId: other.actorId, websiteId: other.websiteId, threadId: thread.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getThread(t.db, { ...c, threadId: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(NotFoundError);
    const mine = await listThreads(t.db, c);
    expect(mine.map((x) => x.title)).toContain("Private question");
    expect(await listThreads(t.db, other)).toEqual([]);
    await renameThread(t.db, { ...c, threadId: thread.id, title: "Renamed" });
    expect((await getThread(t.db, { ...c, threadId: thread.id })).thread.title).toBe("Renamed");
    await deleteThread(t.db, { ...c, threadId: thread.id });
    await expect(getThread(t.db, { ...c, threadId: thread.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listThreads(t.db, c)).map((x) => x.id)).not.toContain(thread.id);
  });

  it("allows one answer run per thread and stores the reply", async () => {
    const { thread } = await createThread(t.db, { ...c, message: "Compare my competitors" });
    const run = await claimRun(t.db, { ...c, threadId: thread.id });
    expect(run.history.map((m) => m.role)).toEqual(["user"]);
    await expect(claimRun(t.db, { ...c, threadId: thread.id })).rejects.toThrow(/already answering/);
    await expect(appendUserMessage(t.db, { ...c, threadId: thread.id, message: "and also?" })).rejects.toBeInstanceOf(DomainError);
    expect(await finishRun(t.db, { threadId: thread.id, claimedAt: run.claimedAt, reply: { content: "Figma leads.", toolCalls: [{ name: "compare_competitors", ok: true }], provider: "simulated", simulated: true, status: "complete" } })).toBe(true);
    const after = await getThread(t.db, { ...c, threadId: thread.id });
    expect(after.thread.runningSince).toBeNull();
    expect(after.messages.map((m) => [m.role, m.content])).toEqual([["user", "Compare my competitors"], ["assistant", "Figma leads."]]);
    // nothing left to answer until the user writes again
    await expect(claimRun(t.db, { ...c, threadId: thread.id })).rejects.toThrow(/nothing to answer/i);
    expect((await getThread(t.db, { ...c, threadId: thread.id })).thread.runningSince).toBeNull();
    await appendUserMessage(t.db, { ...c, threadId: thread.id, message: "Why?" });
    const second = await claimRun(t.db, { ...c, threadId: thread.id });
    expect(second.history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    await releaseRun(t.db, { threadId: thread.id, claimedAt: second.claimedAt });
    expect((await getThread(t.db, { ...c, threadId: thread.id })).thread.runningSince).toBeNull();
  });

  it("reclaims a stale run and drops the late reply of the run it replaced", async () => {
    const { thread } = await createThread(t.db, { ...c, message: "Stale run question" });
    const old = await claimRun(t.db, { ...c, threadId: thread.id, now: new Date(Date.now() - 10 * 60_000) });
    const fresh = await claimRun(t.db, { ...c, threadId: thread.id });
    expect(await finishRun(t.db, { threadId: thread.id, claimedAt: old.claimedAt, reply: { content: "late", toolCalls: [], provider: "x", simulated: false, status: "complete" } })).toBe(false);
    expect(await finishRun(t.db, { threadId: thread.id, claimedAt: fresh.claimedAt, reply: { content: "fresh", toolCalls: [], provider: "x", simulated: false, status: "complete" } })).toBe(true);
    const rows = await t.db.select().from(chatMessages).where(eq(chatMessages.threadId, thread.id));
    expect(rows.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual(["fresh"]);
  });

  it("sends full attachments only for the latest message to the model", () => {
    const long = "x".repeat(10_000);
    const h = historyForModel([
      { role: "user", content: "first", attachments: [{ name: "a.txt", type: "text/plain", size: long.length, text: long }] },
      { role: "assistant", content: "ok", attachments: [] },
      { role: "user", content: "second", attachments: [{ name: "b.txt", type: "text/plain", size: long.length, text: long }] },
    ]);
    expect(h).toHaveLength(3);
    expect(h[0].content).toContain('<attachment name="a.txt"');
    expect(h[0].content.length).toBeLessThan(3_000);
    expect(h[2].content).toContain(long);
  });

  it("drops a late reply when the thread was deleted mid-run and prevents duplicate concurrent follow-ups", async () => {
    const { thread } = await createThread(t.db, { ...c, message: "Initial question" });
    const run = await claimRun(t.db, { ...c, threadId: thread.id });
    await deleteThread(t.db, { ...c, threadId: thread.id });
    expect(
      await finishRun(t.db, {
        threadId: thread.id,
        claimedAt: run.claimedAt,
        reply: { content: "Should not be stored", toolCalls: [], provider: "simulated", simulated: true, status: "complete" },
      }),
    ).toBe(false);
    const msgsAfterDelete = await t.db.select().from(chatMessages).where(eq(chatMessages.threadId, thread.id));
    expect(msgsAfterDelete).toHaveLength(1);

    // Concurrent follow-ups via atomic claimRun({ message })
    const { thread: t2 } = await createThread(t.db, { ...c, message: "First" });
    const r1 = await claimRun(t.db, { ...c, threadId: t2.id });
    await finishRun(t.db, {
      threadId: t2.id,
      claimedAt: r1.claimedAt,
      reply: { content: "First answer", toolCalls: [], provider: "simulated", simulated: true, status: "complete" },
    });

    const settled = await Promise.allSettled([
      claimRun(t.db, { ...c, threadId: t2.id, message: "Follow-up A" }),
      claimRun(t.db, { ...c, threadId: t2.id, message: "Follow-up B" }),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((s) => s.status === "rejected")).toHaveLength(1);
    const afterFollowUp = await getThread(t.db, { ...c, threadId: t2.id });
    expect(afterFollowUp.messages.filter((m) => m.role === "user")).toHaveLength(2);
  });
});
