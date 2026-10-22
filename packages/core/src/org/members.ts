import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { type Db, orgMembers, users, customRoles, websiteMembers, groupMembers, groups, websites } from "@athena/db";
import { assertCanGrant, requireMember, requirePermission } from "./access";
import { logActivity } from "./activity";
import { DomainError, ForbiddenError, NotFoundError } from "./errors";
import { ORG_ROLES, isPermission, permissionsFor, type OrgRole, type Permission } from "./rbac";

export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: OrgRole;
  customRoleId: string | null;
  joinedAt: Date;
}

export async function listMembers(db: Db, opts: { actorId: string; organizationId: string }): Promise<MemberRow[]> {
  await requirePermission(db, opts.actorId, opts.organizationId, "members:read");
  return db
    .select({
      userId: orgMembers.userId,
      email: users.email,
      name: users.name,
      role: orgMembers.role,
      customRoleId: orgMembers.customRoleId,
      joinedAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.organizationId, opts.organizationId))
    .orderBy(asc(orgMembers.createdAt));
}

async function ownerCount(db: Db, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.role, "owner")));
  return row?.n ?? 0;
}

async function currentPermissions(db: Db, role: OrgRole, customRoleId: string | null): Promise<Permission[]> {
  if (role !== "custom" || !customRoleId) return permissionsFor(role);
  const [cr] = await db.select({ permissions: customRoles.permissions }).from(customRoles).where(eq(customRoles.id, customRoleId));
  return permissionsFor("custom", cr?.permissions ?? []);
}

const roleChange = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]),
  customRoleId: z.string().uuid().optional().nullable(),
});

export async function changeMemberRole(db: Db, input: z.input<typeof roleChange>): Promise<void> {
  const data = roleChange.parse(input);
  const actor = await requirePermission(db, data.actorId, data.organizationId, "members:write");
  const [target] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, data.organizationId), eq(orgMembers.userId, data.userId)));
  if (!target) throw new NotFoundError("Member not found");
  // Only owners may grant or revoke the owner role.
  if ((data.role === "owner" || target.role === "owner") && actor.role !== "owner") throw new ForbiddenError();
  if (target.role === "owner" && data.role !== "owner" && (await ownerCount(db, data.organizationId)) <= 1) {
    throw new DomainError("Cannot demote the last owner");
  }
  let customRoleId: string | null = null;
  let granted: Permission[] = permissionsFor(data.role);
  if (data.role === "custom") {
    if (!data.customRoleId) throw new DomainError("Choose a custom role");
    const [cr] = await db
      .select({ id: customRoles.id, permissions: customRoles.permissions })
      .from(customRoles)
      .where(and(eq(customRoles.id, data.customRoleId), eq(customRoles.organizationId, data.organizationId)));
    if (!cr) throw new NotFoundError("Custom role not found");
    customRoleId = cr.id;
    granted = permissionsFor("custom", cr.permissions);
  }
  assertCanGrant(actor, await currentPermissions(db, target.role, target.customRoleId));
  assertCanGrant(actor, granted);
  await db.transaction(async (tx) => {
    await tx
      .update(orgMembers)
      .set({ role: data.role, customRoleId })
      .where(eq(orgMembers.id, target.id));
    await logActivity(tx, {
      organizationId: data.organizationId,
      userId: data.actorId,
      entityType: "member",
      entityId: data.userId,
      change: "role_changed",
      before: { role: target.role, customRoleId: target.customRoleId },
      after: { role: data.role, customRoleId },
    });
  });
}

export async function removeMember(db: Db, input: { actorId: string; organizationId: string; userId: string }): Promise<void> {
  const self = input.actorId === input.userId;
  // anyone may leave; removing someone else needs members:write
  const actor = self
    ? await requireMember(db, input.actorId, input.organizationId)
    : await requirePermission(db, input.actorId, input.organizationId, "members:write");
  const [target] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, input.organizationId), eq(orgMembers.userId, input.userId)));
  if (!target) throw new NotFoundError("Member not found");
  if (target.role === "owner" && !self && actor.role !== "owner") throw new ForbiddenError();
  if (!self) assertCanGrant(actor, await currentPermissions(db, target.role, target.customRoleId));
  if (target.role === "owner" && (await ownerCount(db, input.organizationId)) <= 1) {
    throw new DomainError("Cannot remove the last owner");
  }
  await db.transaction(async (tx) => {
    await tx.delete(orgMembers).where(eq(orgMembers.id, target.id));
    // drop website/group memberships inside this organization
    const siteIds = tx.select({ id: websites.id }).from(websites).where(eq(websites.organizationId, input.organizationId));
    await tx
      .delete(websiteMembers)
      .where(and(eq(websiteMembers.userId, input.userId), sql`${websiteMembers.websiteId} in (${siteIds})`));
    const groupIds = tx.select({ id: groups.id }).from(groups).where(eq(groups.organizationId, input.organizationId));
    await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.userId, input.userId), sql`${groupMembers.groupId} in (${groupIds})`));
    await logActivity(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
      entityType: "member",
      entityId: input.userId,
      change: self ? "left" : "removed",
      before: { role: target.role },
    });
  });
}

const customRoleInput = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  permissions: z.array(z.string()).max(50),
});

export async function createCustomRole(db: Db, input: z.input<typeof customRoleInput>) {
  const data = customRoleInput.parse(input);
  const actor = await requirePermission(db, data.actorId, data.organizationId, "members:write");
  const unknown = data.permissions.filter((p) => !isPermission(p));
  if (unknown.length) throw new DomainError(`Unknown permission: ${unknown.join(", ")}`);
  const perms = [...new Set(data.permissions)] as Permission[];
  assertCanGrant(actor, perms);
  return db.transaction(async (tx) => {
    const [role] = await tx
      .insert(customRoles)
      .values({ organizationId: data.organizationId, name: data.name, permissions: perms })
      .returning();
    await logActivity(tx, {
      organizationId: data.organizationId,
      userId: data.actorId,
      entityType: "custom_role",
      entityId: role.id,
      change: "created",
      after: { name: role.name, permissions: perms },
    });
    return role;
  });
}

export async function listCustomRoles(db: Db, opts: { actorId: string; organizationId: string }) {
  await requirePermission(db, opts.actorId, opts.organizationId, "members:read");
  return db.select().from(customRoles).where(eq(customRoles.organizationId, opts.organizationId)).orderBy(asc(customRoles.name));
}

export async function deleteCustomRole(db: Db, input: { actorId: string; organizationId: string; roleId: string }) {
  await requirePermission(db, input.actorId, input.organizationId, "members:write");
  const [owned] = await db
    .select({ id: customRoles.id })
    .from(customRoles)
    .where(and(eq(customRoles.id, input.roleId), eq(customRoles.organizationId, input.organizationId)));
  if (!owned) throw new NotFoundError("Custom role not found");
  const [inUse] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(eq(orgMembers.customRoleId, owned.id));
  if ((inUse?.n ?? 0) > 0) throw new DomainError("Reassign members using this role first");
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(customRoles)
      .where(and(eq(customRoles.id, input.roleId), eq(customRoles.organizationId, input.organizationId)))
      .returning();
    if (!gone) throw new NotFoundError("Custom role not found");
    await logActivity(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
      entityType: "custom_role",
      entityId: gone.id,
      change: "deleted",
      before: { name: gone.name },
    });
  });
}
