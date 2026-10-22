import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { ForbiddenError, NotFoundError } from "../org/errors";
import { createView, listViews, deleteView, parseDashboardState, stateToFilters } from "./views";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("dashboard state", () => {
  it("parses query params defensively", () => {
    const s = parseDashboardState({ range: "7d", models: "chatgpt,perplexity,<script>", topicId: "nope", cards: "mention,sov,bogus", chart: "simple" });
    expect(s).toMatchObject({ range: "7d", models: ["chatgpt", "perplexity"], cards: ["mention", "sov"], chart: "simple" });
    expect(s.topicId).toBeUndefined();
    expect(parseDashboardState({}).range).toBe("30d");
    expect(parseDashboardState({ range: "custom", from: "2026-10-01", to: "2026-09-01" }).range).toBe("30d"); // invalid custom → default
  });

  it("turns a state into a [from, to) window and the previous window", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    const f = stateToFilters(parseDashboardState({ range: "7d" }), now);
    expect(f.current.to.toISOString()).toBe("2026-10-22T10:00:00.000Z");
    expect(f.current.from.toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(f.previous.from.toISOString()).toBe("2026-10-08T10:00:00.000Z");
    const c = stateToFilters(parseDashboardState({ range: "custom", from: "2026-10-01", to: "2026-10-10" }), now);
    expect(c.current.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(c.current.to.toISOString()).toBe("2026-10-11T00:00:00.000Z"); // inclusive end day
  });
});

describe("saved views", () => {
  it("creates, lists and deletes views per website with access checks", async () => {
    const u = await ensureUserWithOrg(t.db, { email: "views@example.com" });
    const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "views.io", name: "Views" });
    const v = await createView(t.db, { actorId: u.user.id, websiteId: site.id, name: "ChatGPT only", state: parseDashboardState({ models: "chatgpt", range: "14d" }) });
    expect((await listViews(t.db, { actorId: u.user.id, websiteId: site.id })).map((x) => [x.name, x.state.models])).toEqual([["ChatGPT only", ["chatgpt"]]]);
    const outsider = await ensureUserWithOrg(t.db, { email: "views-out@example.com" });
    await expect(listViews(t.db, { actorId: outsider.user.id, websiteId: site.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteView(t.db, { actorId: outsider.user.id, websiteId: site.id, viewId: v.id })).rejects.toBeInstanceOf(ForbiddenError);
    await deleteView(t.db, { actorId: u.user.id, websiteId: site.id, viewId: v.id });
    await expect(deleteView(t.db, { actorId: u.user.id, websiteId: site.id, viewId: v.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});
