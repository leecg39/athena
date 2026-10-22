import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { type Db, groups, groupMembers, websites, orgMembers } from "@athena/db";
import { requirePermission, requireMember } from "./access";
import { logActivity } from "./activity";
import { NotFoundError } from "./errors";

const groupInput = z.object({ actorId: z.string().uuid(), organizationId: z.string().uuid(), name: z.string().trim().min(1).max(80) });

export async function createGroup(db: Db, input: z.input<typeof groupInput>) {
  const data = groupInput.parse(input);
  await requirePermission(db, data.actorId, data.organizationId, "websites:write");
  return db.transaction(async (tx) => {
    const [g] = await tx.insert(groups).values({ organizationId: data.organizationId, name: data.name }).returning();
    await logActivity(tx, { organizationId: data.organizationId, userId: data.actorId, entityType: "group", entityId: g.id, change: "created", after: { name: g.name } });
    return g;
  });
}

export async function listGroups(db: Db, opts: { actorId: string; organizationId: string }) {
  await requireMember(db, opts.actorId, opts.organizationId);
  return db
    .select()
    .from(groups)
    .where(and(eq(groups.organizationId, opts.organizationId), isNull(groups.deletedAt)))
    .orderBy(asc(groups.name));
}

async function assertGroup(db: Db, organizationId: string, groupId: string) {
  const [g] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId), isNull(groups.deletedAt)));
  if (!g) throw new NotFoundError("Group not found");
}

export async function setWebsiteGroup(
  db: Db,
  input: { actorId: string; organizationId: string; websiteId: string; groupId: string | null },
) {
  await requirePermission(db, input.actorId, input.organizationId, "websites:write");
  if (input.groupId) await assertGroup(db, input.organizationId, input.groupId);
  await db.transaction(async (tx) => {
    const [site] = await tx
      .update(websites)
      .set({ groupId: input.groupId })
      .where(and(eq(websites.id, input.websiteId), eq(websites.organizationId, input.organizationId)))
      .returning();
    if (!site) throw new NotFoundError("Website not found");
    await logActivity(tx, { organizationId: input.organizationId, userId: input.actorId, websiteId: site.id, entityType: "website", entityId: site.id, change: "group_changed", after: { groupId: input.groupId } });
  });
}

export async function addGroupMember(db: Db, input: { actorId: string; organizationId: string; groupId: string; userId: string }) {
  await requirePermission(db, input.actorId, input.organizationId, "members:write");
  await assertGroup(db, input.organizationId, input.groupId);
  const [m] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, input.organizationId), eq(orgMembers.userId, input.userId)));
  if (!m) throw new NotFoundError("User is not a member of this organization");
  await db.transaction(async (tx) => {
    await tx.insert(groupMembers).values({ groupId: input.groupId, userId: input.userId }).onConflictDoNothing();
    await logActivity(tx, { organizationId: input.organizationId, userId: input.actorId, entityType: "group", entityId: input.groupId, change: "member_added", after: { userId: input.userId } });
  });
}
