import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { prompts, activityLog } from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { ForbiddenError, DomainError, NotFoundError } from "../org/errors";
import {
  createPrompt,
  updatePrompt,
  deletePrompts,
  bulkPromptAction,
  listPrompts,
  createTopic,
  renameTopic,
  deleteTopic,
  createTag,
  deleteTag,
  createPersona,
  deletePersona,
  createLocation,
  createSchedule,
  archiveSchedule,
  assignSchedule,
  listSchedules,
  listTopics,
  listTags,
} from "./index";
import { saveMonitoringSchedule } from "../onboarding";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

async function setup(email: string) {
  const u = await ensureUserWithOrg(t.db, { email });
  const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: `${email.split("@")[0]}.io`, name: "Canvasly" });
  return { actorId: u.user.id, websiteId: site.id, orgId: u.organizationId };
}

describe("prompt CRUD", () => {
  it("creates, classifies, rejects duplicates and validates references", async () => {
    const c = await setup("p1@example.com");
    const topic = await createTopic(t.db, { ...c, name: "Design" });
    const tag = await createTag(t.db, { ...c, name: "priority", color: "#ff0000" });
    const p = await createPrompt(t.db, { ...c, text: "  is Canvasly good for   teams? ", topicId: topic.id, tagIds: [tag.id] });
    expect(p.text).toBe("is Canvasly good for teams?");
    expect(p.type).toBe("branded");
    await expect(createPrompt(t.db, { ...c, text: "IS CANVASLY GOOD FOR TEAMS?" })).rejects.toBeInstanceOf(DomainError);
    const other = await setup("p1b@example.com");
    const foreignTopic = await createTopic(t.db, { ...other, name: "Theirs" });
    await expect(createPrompt(t.db, { ...c, text: "best whiteboard tools", topicId: foreignTopic.id })).rejects.toBeInstanceOf(NotFoundError);
    const listed = await listPrompts(t.db, { ...c });
    expect(listed.rows[0].tags.map((x) => x.name)).toEqual(["priority"]);
    expect(listed.rows[0].topicName).toBe("Design");
  });

  it("re-classifies on edit, pauses/resumes and logs activity", async () => {
    const c = await setup("p2@example.com");
    const p = await createPrompt(t.db, { ...c, text: "best design tools" });
    expect(p.type).toBe("non_branded");
    const edited = await updatePrompt(t.db, { ...c, promptId: p.id, text: "canvasly vs figma" });
    expect(edited.type).toBe("branded");
    await updatePrompt(t.db, { ...c, promptId: p.id, status: "paused" });
    expect((await listPrompts(t.db, { ...c, filters: { status: "paused" } })).rows).toHaveLength(1);
    const log = await t.db.select().from(activityLog).where(eq(activityLog.entityId, p.id));
    expect(log.map((l) => l.change).sort()).toEqual(["created", "paused", "updated"]);
  });

  it("soft-deletes, excludes deleted rows, and allows re-adding the same text", async () => {
    const c = await setup("p3@example.com");
    const p = await createPrompt(t.db, { ...c, text: "how to pick a canvas app" });
    await deletePrompts(t.db, { ...c, promptIds: [p.id] });
    expect((await listPrompts(t.db, c)).rows).toHaveLength(0);
    const [row] = await t.db.select().from(prompts).where(eq(prompts.id, p.id));
    expect(row.status).toBe("deleted");
    await expect(createPrompt(t.db, { ...c, text: "how to pick a canvas app" })).resolves.toBeTruthy();
  });

  it("filters and searches safely", async () => {
    const c = await setup("p4@example.com");
    const topic = await createTopic(t.db, { ...c, name: "Pricing" });
    await createPrompt(t.db, { ...c, text: "100% free design tools", topicId: topic.id });
    await createPrompt(t.db, { ...c, text: "design_tokens explained" });
    await createPrompt(t.db, { ...c, text: "canvas pricing comparison" });
    expect((await listPrompts(t.db, { ...c, filters: { q: "%" } })).rows.map((r) => r.text)).toEqual(["100% free design tools"]);
    expect((await listPrompts(t.db, { ...c, filters: { q: "_" } })).rows.map((r) => r.text)).toEqual(["design_tokens explained"]);
    expect((await listPrompts(t.db, { ...c, filters: { topicId: topic.id } })).total).toBe(1);
    expect((await listPrompts(t.db, { ...c, filters: { type: "non_branded" } })).total).toBe(3);
  });

  it("applies bulk actions only to the website's own prompts", async () => {
    const c = await setup("p5@example.com");
    const a = await createPrompt(t.db, { ...c, text: "first canvas question" });
    const b = await createPrompt(t.db, { ...c, text: "second canvas question" });
    const other = await setup("p5b@example.com");
    const foreign = await createPrompt(t.db, { ...other, text: "foreign question here" });
    const tag = await createTag(t.db, { ...c, name: "q4" });
    const r = await bulkPromptAction(t.db, { ...c, promptIds: [a.id, b.id, foreign.id], action: "pause" });
    expect(r.affected).toBe(2);
    await bulkPromptAction(t.db, { ...c, promptIds: [a.id, b.id], action: "tag", value: tag.id });
    expect((await listPrompts(t.db, { ...c, filters: { tagId: tag.id } })).total).toBe(2);
    const [f] = await t.db.select().from(prompts).where(eq(prompts.id, foreign.id));
    expect(f.status).toBe("active");
  });

  it("forbids writers without prompts:write and outsiders", async () => {
    const c = await setup("p6@example.com");
    const outsider = await ensureUserWithOrg(t.db, { email: "out6@example.com" });
    await expect(createPrompt(t.db, { actorId: outsider.user.id, websiteId: c.websiteId, text: "sneaky prompt here" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPrompts(t.db, { actorId: outsider.user.id, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("taxonomy", () => {
  it("renames topics uniquely and detaches prompts on delete", async () => {
    const c = await setup("tx1@example.com");
    const a = await createTopic(t.db, { ...c, name: "A" });
    await createTopic(t.db, { ...c, name: "B" });
    await expect(renameTopic(t.db, { ...c, topicId: a.id, name: "b" })).rejects.toBeInstanceOf(DomainError);
    const p = await createPrompt(t.db, { ...c, text: "question in topic a", topicId: a.id });
    const tag = await createTag(t.db, { ...c, name: "counted" });
    await bulkPromptAction(t.db, { ...c, promptIds: [p.id], action: "tag", value: tag.id });
    expect((await listTopics(t.db, c)).map((x) => [x.name, x.promptCount])).toEqual([["A", 1], ["B", 0]]);
    expect((await listTags(t.db, c)).find((x) => x.id === tag.id)?.promptCount).toBe(1);
    await deleteTopic(t.db, { ...c, topicId: a.id });
    const [row] = await t.db.select().from(prompts).where(eq(prompts.id, p.id));
    expect(row.topicId).toBeNull();
  });

  it("deletes tags and personas, detaching them from prompts", async () => {
    const c = await setup("tx2@example.com");
    const tag = await createTag(t.db, { ...c, name: "t" });
    const persona = await createPersona(t.db, { ...c, name: "Designer", description: "UI" });
    const loc = await createLocation(t.db, { ...c, name: "Seoul", country: "KR" });
    const p = await createPrompt(t.db, { ...c, text: "question with refs", tagIds: [tag.id], personaId: persona.id, locationId: loc.id });
    await deleteTag(t.db, { ...c, tagId: tag.id });
    await deletePersona(t.db, { ...c, personaId: persona.id });
    const listed = await listPrompts(t.db, c);
    expect(listed.rows.find((r) => r.id === p.id)?.tags).toEqual([]);
    expect(listed.rows.find((r) => r.id === p.id)?.personaName).toBeNull();
    expect(listed.rows.find((r) => r.id === p.id)?.locationName).toBe("Seoul");
  });
});

describe("schedules", () => {
  it("creates custom schedules, assigns prompts, protects the default and re-homes prompts on archive", async () => {
    const c = await setup("s1@example.com");
    const def = await saveMonitoringSchedule(t.db, { ...c, cadence: "daily" });
    const p = await createPrompt(t.db, { ...c, text: "scheduled question one" });
    expect(p.scheduleId).toBe(def.id);
    const weekly = await createSchedule(t.db, { ...c, name: "Low priority", cadence: "weekly" });
    await assignSchedule(t.db, { ...c, scheduleId: weekly.id, promptIds: [p.id] });
    expect((await listSchedules(t.db, c)).find((s) => s.id === weekly.id)?.promptCount).toBe(1);
    await expect(archiveSchedule(t.db, { ...c, scheduleId: def.id })).rejects.toBeInstanceOf(DomainError);
    await archiveSchedule(t.db, { ...c, scheduleId: weekly.id });
    const [row] = await t.db.select().from(prompts).where(eq(prompts.id, p.id));
    expect(row.scheduleId).toBe(def.id);
    expect((await listSchedules(t.db, c)).map((s) => s.id)).not.toContain(weekly.id);
  });
});
