/** Tracked prompt CRUD, filtered listing and bulk actions (tenant-scoped, audited). */
import { z } from "zod";
import { and, asc, desc, eq, exists, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { type Db, prompts, topics, personas, locations, promptTags, promptTagLinks, promptSchedules } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { cleanPromptText, defaultScheduleId, escapeLike, isBrandedPrompt, lockWebsite, promptLimitFor, type DbOrTx } from "./shared";

const id = z.string().uuid();
const ctx = { actorId: id, websiteId: id };

export interface PromptListItem {
  id: string;
  text: string;
  type: "branded" | "non_branded";
  status: "active" | "paused" | "deleted";
  topicId: string | null;
  topicName: string | null;
  personaId: string | null;
  personaName: string | null;
  locationId: string | null;
  locationName: string | null;
  scheduleId: string | null;
  volumeEstimate: number | null;
  createdAt: Date;
  tags: { id: string; name: string; color: string | null }[];
}

export interface PromptFilters {
  topicId?: string;
  tagId?: string;
  personaId?: string;
  locationId?: string;
  scheduleId?: string;
  status?: "active" | "paused";
  type?: "branded" | "non_branded";
  q?: string;
}

/** Ensure an optional foreign id belongs to the website (live row), else NotFound. */
async function assertOwned(
  db: DbOrTx,
  table: typeof topics | typeof personas | typeof locations,
  rowId: string | null | undefined,
  websiteId: string,
  label: string,
): Promise<void> {
  if (!rowId) return;
  const [hit] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, rowId), eq(table.websiteId, websiteId), isNull(table.deletedAt)));
  if (!hit) throw new NotFoundError(`${label} not found`);
}

async function assertTags(db: DbOrTx, tagIds: string[], websiteId: string): Promise<void> {
  if (!tagIds.length) return;
  const rows = await db
    .select({ id: promptTags.id })
    .from(promptTags)
    .where(and(inArray(promptTags.id, tagIds), eq(promptTags.websiteId, websiteId)));
  if (rows.length !== new Set(tagIds).size) throw new NotFoundError("Tag not found");
}

async function assertSchedule(db: DbOrTx, scheduleId: string | null | undefined, websiteId: string): Promise<void> {
  if (!scheduleId) return;
  const [hit] = await db
    .select({ id: promptSchedules.id })
    .from(promptSchedules)
    .where(and(eq(promptSchedules.id, scheduleId), eq(promptSchedules.websiteId, websiteId), isNull(promptSchedules.archivedAt)));
  if (!hit) throw new NotFoundError("Schedule not found");
}

async function duplicateExists(db: DbOrTx, websiteId: string, text: string, exceptId?: string): Promise<boolean> {
  const conds: SQL[] = [eq(prompts.websiteId, websiteId), isNull(prompts.deletedAt), sql`lower(${prompts.text}) = lower(${text})`];
  if (exceptId) conds.push(ne(prompts.id, exceptId));
  const [hit] = await db.select({ id: prompts.id }).from(prompts).where(and(...conds));
  return Boolean(hit);
}

/* ---------------- list ---------------- */

const listInput = z.object({
  ...ctx,
  filters: z
    .object({
      topicId: id.optional(),
      tagId: id.optional(),
      personaId: id.optional(),
      locationId: id.optional(),
      scheduleId: id.optional(),
      status: z.enum(["active", "paused"]).optional(),
      type: z.enum(["branded", "non_branded"]).optional(),
      q: z.string().trim().max(200).optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export async function listPrompts(db: Db, input: z.input<typeof listInput>): Promise<{ rows: PromptListItem[]; total: number }> {
  const data = listInput.parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:read");
  const f = data.filters ?? {};
  const conds: SQL[] = [eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)];
  if (f.topicId) conds.push(eq(prompts.topicId, f.topicId));
  if (f.personaId) conds.push(eq(prompts.personaId, f.personaId));
  if (f.locationId) conds.push(eq(prompts.locationId, f.locationId));
  if (f.scheduleId) conds.push(eq(prompts.scheduleId, f.scheduleId));
  if (f.status) conds.push(eq(prompts.status, f.status));
  if (f.type) conds.push(eq(prompts.type, f.type));
  if (f.q) conds.push(sql`${prompts.text} ilike ${`%${escapeLike(f.q)}%`} escape '\\'`);
  if (f.tagId) {
    conds.push(
      exists(
        db
          .select({ one: promptTagLinks.promptId })
          .from(promptTagLinks)
          .where(and(eq(promptTagLinks.promptId, prompts.id), eq(promptTagLinks.tagId, f.tagId))),
      ),
    );
  }
  const where = and(...conds);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: prompts.id,
        text: prompts.text,
        type: prompts.type,
        status: prompts.status,
        topicId: prompts.topicId,
        topicName: topics.name,
        personaId: prompts.personaId,
        personaName: personas.name,
        locationId: prompts.locationId,
        locationName: locations.name,
        scheduleId: prompts.scheduleId,
        volumeEstimate: prompts.volumeEstimate,
        createdAt: prompts.createdAt,
      })
      .from(prompts)
      .leftJoin(topics, and(eq(topics.id, prompts.topicId), isNull(topics.deletedAt)))
      .leftJoin(personas, and(eq(personas.id, prompts.personaId), isNull(personas.deletedAt)))
      .leftJoin(locations, and(eq(locations.id, prompts.locationId), isNull(locations.deletedAt)))
      .where(where)
      .orderBy(desc(prompts.createdAt), asc(prompts.id))
      .limit(data.limit ?? 100)
      .offset(data.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(prompts).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await db
        .select({ promptId: promptTagLinks.promptId, id: promptTags.id, name: promptTags.name, color: promptTags.color })
        .from(promptTagLinks)
        .innerJoin(promptTags, eq(promptTags.id, promptTagLinks.tagId))
        .where(inArray(promptTagLinks.promptId, ids))
        .orderBy(asc(promptTags.name))
    : [];
  return {
    rows: rows.map((r) => ({
      ...r,
      status: r.status,
      tags: links.filter((l) => l.promptId === r.id).map(({ id: tagId, name, color }) => ({ id: tagId, name, color })),
    })),
    total: count?.n ?? 0,
  };
}

/* ---------------- create / update / delete ---------------- */

const createInput = z.object({
  ...ctx,
  text: z.string().max(600),
  topicId: id.nullish(),
  personaId: id.nullish(),
  locationId: id.nullish(),
  scheduleId: id.nullish(),
  tagIds: z.array(id).max(20).optional(),
  volumeEstimate: z.number().int().min(0).optional(),
});

export async function createPrompt(db: Db, input: z.input<typeof createInput>) {
  const data = createInput.parse(input);
  const text = cleanPromptText(data.text);
  if (text.length < 5 || text.length > 500) throw new DomainError("Prompts must be between 5 and 500 characters");
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    await lockWebsite(tx, site.id);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(prompts)
      .where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
    const limit = await promptLimitFor(tx, site.organizationId);
    if ((count?.n ?? 0) >= limit) throw new DomainError(`Prompt limit reached: your plan allows ${limit} tracked prompts per website`);
    if (await duplicateExists(tx, site.id, text)) throw new DomainError("This prompt is already tracked");
    await assertOwned(tx, topics, data.topicId, site.id, "Topic");
    await assertOwned(tx, personas, data.personaId, site.id, "Persona");
    await assertOwned(tx, locations, data.locationId, site.id, "Location");
    await assertSchedule(tx, data.scheduleId, site.id);
    await assertTags(tx, data.tagIds ?? [], site.id);
    const [row] = await tx
      .insert(prompts)
      .values({
        websiteId: site.id,
        text,
        type: isBrandedPrompt(text, site.name, site.domain) ? "branded" : "non_branded",
        topicId: data.topicId ?? null,
        personaId: data.personaId ?? null,
        locationId: data.locationId ?? null,
        scheduleId: data.scheduleId ?? (await defaultScheduleId(tx, site.id)),
        volumeEstimate: data.volumeEstimate ?? 0,
      })
      .returning();
    if (data.tagIds?.length) {
      await tx.insert(promptTagLinks).values([...new Set(data.tagIds)].map((tagId) => ({ promptId: row.id, tagId }))).onConflictDoNothing();
    }
    await logActivity(tx, { organizationId: site.organizationId, userId: data.actorId, websiteId: site.id, entityType: "prompt", entityId: row.id, change: "created", after: { text } });
    return row;
  });
}

const updateInput = z.object({
  ...ctx,
  promptId: id,
  text: z.string().max(600).optional(),
  topicId: id.nullish(),
  personaId: id.nullish(),
  locationId: id.nullish(),
  status: z.enum(["active", "paused"]).optional(),
});

export async function updatePrompt(db: Db, input: z.input<typeof updateInput>) {
  const data = updateInput.parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, data.promptId), eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
    if (!before) throw new NotFoundError("Prompt not found");
    const patch: Partial<typeof prompts.$inferInsert> = {};
    if (data.text !== undefined) {
      const text = cleanPromptText(data.text);
      if (text.length < 5 || text.length > 500) throw new DomainError("Prompts must be between 5 and 500 characters");
      if (await duplicateExists(tx, site.id, text, before.id)) throw new DomainError("This prompt is already tracked");
      patch.text = text;
      patch.type = isBrandedPrompt(text, site.name, site.domain) ? "branded" : "non_branded";
    }
    if (data.topicId !== undefined) {
      await assertOwned(tx, topics, data.topicId, site.id, "Topic");
      patch.topicId = data.topicId;
    }
    if (data.personaId !== undefined) {
      await assertOwned(tx, personas, data.personaId, site.id, "Persona");
      patch.personaId = data.personaId;
    }
    if (data.locationId !== undefined) {
      await assertOwned(tx, locations, data.locationId, site.id, "Location");
      patch.locationId = data.locationId;
    }
    if (data.status) patch.status = data.status;
    if (!Object.keys(patch).length) return before;
    const [after] = await tx.update(prompts).set(patch).where(eq(prompts.id, before.id)).returning();
    const onlyStatus = Object.keys(patch).length === 1 && data.status && data.status !== before.status;
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: data.actorId,
      websiteId: site.id,
      entityType: "prompt",
      entityId: before.id,
      change: onlyStatus ? (data.status === "paused" ? "paused" : "unpaused") : "updated",
      before: { text: before.text, status: before.status, topicId: before.topicId },
      after: { text: after.text, status: after.status, topicId: after.topicId },
    });
    return after;
  });
}

export async function deletePrompts(db: Db, input: { actorId: string; websiteId: string; promptIds: string[] }) {
  return bulkPromptAction(db, { ...input, action: "delete" });
}

/* ---------------- bulk ---------------- */

const bulkInput = z.object({
  ...ctx,
  promptIds: z.array(id).min(1).max(500),
  action: z.enum(["pause", "resume", "delete", "move_topic", "tag", "untag", "set_schedule"]),
  value: id.nullish(),
});

export async function bulkPromptAction(db: Db, input: z.input<typeof bulkInput>): Promise<{ affected: number }> {
  const data = bulkInput.parse(input);
  const site: WebsiteRow = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: prompts.id })
      .from(prompts)
      .where(and(eq(prompts.websiteId, site.id), inArray(prompts.id, data.promptIds), isNull(prompts.deletedAt)));
    const ids = owned.map((o) => o.id);
    if (!ids.length) return { affected: 0 };
    const where = inArray(prompts.id, ids);
    switch (data.action) {
      case "pause":
        await tx.update(prompts).set({ status: "paused" }).where(where);
        break;
      case "resume":
        await tx.update(prompts).set({ status: "active" }).where(where);
        break;
      case "delete":
        await tx.update(prompts).set({ status: "deleted", deletedAt: new Date() }).where(where);
        break;
      case "move_topic":
        await assertOwned(tx, topics, data.value, site.id, "Topic");
        await tx.update(prompts).set({ topicId: data.value ?? null }).where(where);
        break;
      case "set_schedule":
        if (!data.value) throw new DomainError("Choose a schedule");
        await assertSchedule(tx, data.value, site.id);
        await tx.update(prompts).set({ scheduleId: data.value }).where(where);
        break;
      case "tag":
      case "untag": {
        if (!data.value) throw new DomainError("Choose a tag");
        await assertTags(tx, [data.value], site.id);
        if (data.action === "tag") {
          await tx.insert(promptTagLinks).values(ids.map((promptId) => ({ promptId, tagId: data.value! }))).onConflictDoNothing();
        } else {
          await tx.delete(promptTagLinks).where(and(eq(promptTagLinks.tagId, data.value), inArray(promptTagLinks.promptId, ids)));
        }
        break;
      }
    }
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: data.actorId,
      websiteId: site.id,
      entityType: "prompt",
      change: data.action === "delete" ? "deleted" : `bulk_${data.action}`,
      after: { count: ids.length, ids: ids.slice(0, 50), value: data.value ?? null },
    });
    return { affected: ids.length };
  });
}
