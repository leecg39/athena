/** Topics, tags, personas and locations for a website's prompts (tenant-scoped, audited). */
import { z } from "zod";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { type Db, topics, promptTags, promptTagLinks, personas, locations, prompts } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";

const id = z.string().uuid();
const ctx = { actorId: id, websiteId: id };
const name = (max: number) => z.string().trim().min(1).max(max);

async function audit(
  db: Parameters<typeof logActivity>[0],
  site: { id: string; organizationId: string },
  actorId: string,
  entityType: string,
  entityId: string,
  change: string,
  after?: unknown,
) {
  await logActivity(db, { organizationId: site.organizationId, userId: actorId, websiteId: site.id, entityType, entityId, change, after });
}

/* ---------------- topics ---------------- */

export async function listTopics(db: Db, input: { actorId: string; websiteId: string }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return db
    .select({
      id: topics.id,
      name: topics.name,
      description: topics.description,
      promptCount: sql<number>`(select count(*)::int from prompts p where p.topic_id = "topics"."id" and p.deleted_at is null)`,
    })
    .from(topics)
    .where(and(eq(topics.websiteId, site.id), isNull(topics.deletedAt)))
    .orderBy(asc(topics.name));
}

async function topicNameTaken(db: Db, websiteId: string, value: string, exceptId?: string) {
  const conds = [eq(topics.websiteId, websiteId), isNull(topics.deletedAt), sql`lower(${topics.name}) = lower(${value})`];
  if (exceptId) conds.push(ne(topics.id, exceptId));
  const [hit] = await db.select({ id: topics.id }).from(topics).where(and(...conds));
  return Boolean(hit);
}

export async function createTopic(db: Db, input: { actorId: string; websiteId: string; name: string; description?: string }) {
  const data = z.object({ ...ctx, name: name(80), description: z.string().trim().max(300).optional() }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  if (await topicNameTaken(db, site.id, data.name)) throw new DomainError("A topic with this name already exists");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(topics).values({ websiteId: site.id, name: data.name, description: data.description || null }).returning();
    await audit(tx, site, data.actorId, "topic", row.id, "created", { name: row.name });
    return row;
  });
}

export async function renameTopic(db: Db, input: { actorId: string; websiteId: string; topicId: string; name: string }) {
  const data = z.object({ ...ctx, topicId: id, name: name(80) }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  if (await topicNameTaken(db, site.id, data.name, data.topicId)) throw new DomainError("A topic with this name already exists");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(topics)
      .set({ name: data.name })
      .where(and(eq(topics.id, data.topicId), eq(topics.websiteId, site.id), isNull(topics.deletedAt)))
      .returning();
    if (!row) throw new NotFoundError("Topic not found");
    await audit(tx, site, data.actorId, "topic", row.id, "updated", { name: row.name });
    return row;
  });
}

export async function deleteTopic(db: Db, input: { actorId: string; websiteId: string; topicId: string }) {
  const data = z.object({ ...ctx, topicId: id }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(topics)
      .set({ deletedAt: new Date() })
      .where(and(eq(topics.id, data.topicId), eq(topics.websiteId, site.id), isNull(topics.deletedAt)))
      .returning();
    if (!row) throw new NotFoundError("Topic not found");
    await tx.update(prompts).set({ topicId: null }).where(eq(prompts.topicId, row.id));
    await audit(tx, site, data.actorId, "topic", row.id, "deleted", { name: row.name });
  });
}

/* ---------------- tags ---------------- */

const COLOR = /^#[0-9a-f]{6}$/i;

export async function listTags(db: Db, input: { actorId: string; websiteId: string }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return db
    .select({
      id: promptTags.id,
      name: promptTags.name,
      color: promptTags.color,
      promptCount: sql<number>`(select count(*)::int from prompt_tag_links l join prompts p on p.id = l.prompt_id where l.tag_id = "prompt_tags"."id" and p.deleted_at is null)`,
    })
    .from(promptTags)
    .where(eq(promptTags.websiteId, site.id))
    .orderBy(asc(promptTags.name));
}

export async function createTag(db: Db, input: { actorId: string; websiteId: string; name: string; color?: string }) {
  const data = z.object({ ...ctx, name: name(40), color: z.string().regex(COLOR, "Use a hex color like #4f39f6").optional() }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  const [taken] = await db
    .select({ id: promptTags.id })
    .from(promptTags)
    .where(and(eq(promptTags.websiteId, site.id), sql`lower(${promptTags.name}) = lower(${data.name})`));
  if (taken) throw new DomainError("A tag with this name already exists");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(promptTags).values({ websiteId: site.id, name: data.name, color: data.color ?? "#4f39f6" }).returning();
    await audit(tx, site, data.actorId, "tag", row.id, "created", { name: row.name });
    return row;
  });
}

export async function deleteTag(db: Db, input: { actorId: string; websiteId: string; tagId: string }) {
  const data = z.object({ ...ctx, tagId: id }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [owned] = await tx.select().from(promptTags).where(and(eq(promptTags.id, data.tagId), eq(promptTags.websiteId, site.id)));
    if (!owned) throw new NotFoundError("Tag not found");
    await tx.delete(promptTagLinks).where(eq(promptTagLinks.tagId, owned.id));
    await tx.delete(promptTags).where(eq(promptTags.id, owned.id));
    await audit(tx, site, data.actorId, "tag", owned.id, "deleted", { name: owned.name });
  });
}

/* ---------------- personas ---------------- */

export async function listPersonas(db: Db, input: { actorId: string; websiteId: string }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return db.select().from(personas).where(and(eq(personas.websiteId, site.id), isNull(personas.deletedAt))).orderBy(asc(personas.name));
}

export async function createPersona(db: Db, input: { actorId: string; websiteId: string; name: string; description?: string }) {
  const data = z.object({ ...ctx, name: name(60), description: z.string().trim().max(300).optional() }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(personas)
      .values({ websiteId: site.id, name: data.name, description: data.description || null })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new DomainError("A persona with this name already exists");
    await audit(tx, site, data.actorId, "persona", row.id, "created", { name: row.name });
    return row;
  });
}

export async function updatePersona(db: Db, input: { actorId: string; websiteId: string; personaId: string; name: string; description?: string }) {
  const data = z.object({ ...ctx, personaId: id, name: name(60), description: z.string().trim().max(300).optional() }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  const [clash] = await db
    .select({ id: personas.id })
    .from(personas)
    .where(and(eq(personas.websiteId, site.id), isNull(personas.deletedAt), ne(personas.id, data.personaId), sql`lower(${personas.name}) = lower(${data.name})`));
  if (clash) throw new DomainError("A persona with this name already exists");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(personas)
      .set({ name: data.name, description: data.description || null })
      .where(and(eq(personas.id, data.personaId), eq(personas.websiteId, site.id), isNull(personas.deletedAt)))
      .returning();
    if (!row) throw new NotFoundError("Persona not found");
    await audit(tx, site, data.actorId, "persona", row.id, "updated", { name: row.name });
    return row;
  });
}

export async function deletePersona(db: Db, input: { actorId: string; websiteId: string; personaId: string }) {
  const data = z.object({ ...ctx, personaId: id }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(personas)
      .set({ deletedAt: new Date() })
      .where(and(eq(personas.id, data.personaId), eq(personas.websiteId, site.id), isNull(personas.deletedAt)))
      .returning();
    if (!row) throw new NotFoundError("Persona not found");
    await tx.update(prompts).set({ personaId: null }).where(eq(prompts.personaId, row.id));
    await audit(tx, site, data.actorId, "persona", row.id, "deleted", { name: row.name });
  });
}

/* ---------------- locations ---------------- */

export async function listLocations(db: Db, input: { actorId: string; websiteId: string }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return db.select().from(locations).where(and(eq(locations.websiteId, site.id), isNull(locations.deletedAt))).orderBy(asc(locations.name));
}

export async function createLocation(db: Db, input: { actorId: string; websiteId: string; name: string; country: string }) {
  const data = z
    .object({ ...ctx, name: name(80), country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter country code") })
    .parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(locations).values({ websiteId: site.id, name: data.name, country: data.country }).onConflictDoNothing().returning();
    if (!row) throw new DomainError("This location already exists");
    await audit(tx, site, data.actorId, "location", row.id, "created", { name: row.name, country: row.country });
    return row;
  });
}

export async function deleteLocation(db: Db, input: { actorId: string; websiteId: string; locationId: string }) {
  const data = z.object({ ...ctx, locationId: id }).parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(locations)
      .set({ deletedAt: new Date() })
      .where(and(eq(locations.id, data.locationId), eq(locations.websiteId, site.id), isNull(locations.deletedAt)))
      .returning();
    if (!row) throw new NotFoundError("Location not found");
    await tx.update(prompts).set({ locationId: null }).where(eq(prompts.locationId, row.id));
    await audit(tx, site, data.actorId, "location", row.id, "deleted", { name: row.name });
  });
}
