import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type Db, organizations, users, websites } from "@athena/db";
import { requirePermission } from "./access";
import { logActivity } from "./activity";
import { NotFoundError } from "./errors";

const orgInput = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export async function updateOrganization(db: Db, input: z.input<typeof orgInput>) {
  const data = orgInput.parse(input);
  await requirePermission(db, data.actorId, data.organizationId, "settings:write");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, data.organizationId));
    const [org] = await tx.update(organizations).set({ name: data.name }).where(eq(organizations.id, data.organizationId)).returning();
    await logActivity(tx, {
      organizationId: data.organizationId,
      userId: data.actorId,
      entityType: "organization",
      entityId: org.id,
      change: "updated",
      before: { name: before?.name },
      after: { name: org.name },
    });
    return org;
  });
}

const websiteInput = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  websiteId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter country code"),
  timezone: z.string().trim().min(1).max(64),
});

export async function updateWebsiteSettings(db: Db, input: z.input<typeof websiteInput>) {
  const data = websiteInput.parse(input);
  await requirePermission(db, data.actorId, data.organizationId, "websites:write");
  if (!Intl.supportedValuesOf("timeZone").includes(data.timezone) && data.timezone !== "UTC") {
    throw new z.ZodError([{ code: "custom", path: ["timezone"], message: "Unknown timezone" }]);
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(websites)
      .where(and(eq(websites.id, data.websiteId), eq(websites.organizationId, data.organizationId), isNull(websites.deletedAt)));
    if (!before) throw new NotFoundError("Website not found");
    const [site] = await tx
      .update(websites)
      .set({ name: data.name, country: data.country, timezone: data.timezone })
      .where(eq(websites.id, before.id))
      .returning();
    await logActivity(tx, {
      organizationId: data.organizationId,
      userId: data.actorId,
      websiteId: site.id,
      entityType: "website",
      entityId: site.id,
      change: "updated",
      before: { name: before.name, country: before.country, timezone: before.timezone },
      after: { name: site.name, country: site.country, timezone: site.timezone },
    });
    return site;
  });
}

export async function deleteWebsite(db: Db, input: { actorId: string; organizationId: string; websiteId: string }) {
  await requirePermission(db, input.actorId, input.organizationId, "websites:write");
  await db.transaction(async (tx) => {
    const [site] = await tx
      .update(websites)
      .set({ deletedAt: new Date() })
      .where(and(eq(websites.id, input.websiteId), eq(websites.organizationId, input.organizationId), isNull(websites.deletedAt)))
      .returning();
    if (!site) throw new NotFoundError("Website not found");
    await logActivity(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "website",
      entityId: site.id,
      change: "deleted",
      before: { name: site.name, domain: site.domain },
    });
  });
}

const profileInput = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  jobTitle: z.string().trim().max(120).optional().nullable(),
});

export async function updateProfile(db: Db, input: z.input<typeof profileInput>) {
  const data = profileInput.parse(input);
  const [user] = await db
    .update(users)
    .set({ name: data.name, jobTitle: data.jobTitle || null })
    .where(eq(users.id, data.userId))
    .returning();
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export async function getSessionVersion(db: Db, userId: string): Promise<number | null> {
  const [row] = await db.select({ v: users.sessionVersion }).from(users).where(eq(users.id, userId));
  return row?.v ?? null;
}

/** Invalidate every outstanding session of the user ("sign out everywhere"). */
export async function bumpSessionVersion(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
    .returning({ v: users.sessionVersion });
  if (!row) throw new NotFoundError("User not found");
  return row.v;
}
