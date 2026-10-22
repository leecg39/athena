/** Collection schedules: one default plus custom cadences; archiving re-homes prompts. */
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Db, promptSchedules, prompts } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { CADENCES } from "../onboarding";
import { defaultScheduleId } from "./shared";

const id = z.string().uuid();
const ctx = { actorId: id, websiteId: id };

export async function listSchedules(db: Db, input: { actorId: string; websiteId: string }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return db
    .select({
      id: promptSchedules.id,
      name: promptSchedules.name,
      kind: promptSchedules.kind,
      cadence: promptSchedules.cadence,
      createdAt: promptSchedules.createdAt,
      promptCount: sql<number>`(select count(*)::int from prompts p where p.schedule_id = "prompt_schedules"."id" and p.deleted_at is null)`,
    })
    .from(promptSchedules)
    .where(and(eq(promptSchedules.websiteId, site.id), isNull(promptSchedules.archivedAt)))
    .orderBy(asc(promptSchedules.createdAt));
}

export async function createSchedule(db: Db, input: { actorId: string; websiteId: string; name: string; cadence: string }) {
  const data = z.object({ ...ctx, name: z.string().trim().min(1).max(60), cadence: z.enum(CADENCES) }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(promptSchedules).values({ websiteId: site.id, name: data.name, kind: "custom", cadence: data.cadence }).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "schedule", entityId: row.id, change: "created", after: { name: row.name, cadence: row.cadence } });
    return row;
  });
}

export async function updateScheduleCadence(db: Db, input: { actorId: string; websiteId: string; scheduleId: string; cadence: string }) {
  const data = z.object({ ...ctx, scheduleId: id, cadence: z.enum(CADENCES) }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(promptSchedules)
      .set({ cadence: data.cadence })
      .where(and(eq(promptSchedules.id, data.scheduleId), eq(promptSchedules.websiteId, site.id), isNull(promptSchedules.archivedAt)))
      .returning();
    if (!row) throw new NotFoundError("Schedule not found");
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "schedule", entityId: row.id, change: "updated", after: { cadence: row.cadence } });
    return row;
  });
}

export async function assignSchedule(db: Db, input: { actorId: string; websiteId: string; scheduleId: string; promptIds: string[] }) {
  const data = z.object({ ...ctx, scheduleId: id, promptIds: z.array(id).min(1).max(500) }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const [s] = await tx
      .select({ id: promptSchedules.id })
      .from(promptSchedules)
      .where(and(eq(promptSchedules.id, data.scheduleId), eq(promptSchedules.websiteId, site.id), isNull(promptSchedules.archivedAt)));
    if (!s) throw new NotFoundError("Schedule not found");
    const moved = await tx
      .update(prompts)
      .set({ scheduleId: s.id })
      .where(and(eq(prompts.websiteId, site.id), inArray(prompts.id, data.promptIds), isNull(prompts.deletedAt)))
      .returning({ id: prompts.id });
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "schedule", entityId: s.id, change: "prompts_assigned", after: { count: moved.length } });
    return { affected: moved.length };
  });
}

export async function archiveSchedule(db: Db, input: { actorId: string; websiteId: string; scheduleId: string }) {
  const data = z.object({ ...ctx, scheduleId: id }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(promptSchedules)
      .where(and(eq(promptSchedules.id, data.scheduleId), eq(promptSchedules.websiteId, site.id), isNull(promptSchedules.archivedAt)));
    if (!s) throw new NotFoundError("Schedule not found");
    if (s.kind === "default") throw new DomainError("The default schedule cannot be archived");
    await tx.update(promptSchedules).set({ kind: "archived", archivedAt: new Date() }).where(eq(promptSchedules.id, s.id));
    await tx.update(prompts).set({ scheduleId: await defaultScheduleId(tx, site.id) }).where(eq(prompts.scheduleId, s.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "schedule", entityId: s.id, change: "archived", before: { name: s.name, cadence: s.cadence } });
  });
}
