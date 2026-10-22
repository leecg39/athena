import { and, eq, isNull } from "drizzle-orm";
import { type Db, orgMembers, organizations, customRoles } from "@athena/db";
import { ForbiddenError } from "./errors";
import { permissionsFor, type OrgRole, type Permission } from "./rbac";

export interface Membership {
  userId: string;
  organizationId: string;
  role: OrgRole;
  customRoleId: string | null;
  permissions: Permission[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The user's membership in a live organization, with resolved permissions. */
export async function getMembership(db: Db, userId: string, organizationId: string): Promise<Membership | null> {
  if (!UUID_RE.test(userId) || !UUID_RE.test(organizationId)) return null;
  const [row] = await db
    .select({ role: orgMembers.role, customRoleId: orgMembers.customRoleId, perms: customRoles.permissions })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organizationId))
    .leftJoin(customRoles, eq(customRoles.id, orgMembers.customRoleId))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.organizationId, organizationId), isNull(organizations.deletedAt)));
  if (!row) return null;
  return {
    userId,
    organizationId,
    role: row.role,
    customRoleId: row.customRoleId,
    permissions: permissionsFor(row.role, row.perms ?? []),
  };
}

/** Membership that holds `permission`, else ForbiddenError (also for non-members). */
export async function requirePermission(
  db: Db,
  userId: string,
  organizationId: string,
  permission: Permission,
): Promise<Membership> {
  const m = await getMembership(db, userId, organizationId);
  if (!m || !m.permissions.includes(permission)) throw new ForbiddenError();
  return m;
}

/** Any membership (read access to org-level basics). */
export async function requireMember(db: Db, userId: string, organizationId: string): Promise<Membership> {
  const m = await getMembership(db, userId, organizationId);
  if (!m) throw new ForbiddenError();
  return m;
}

/**
 * Least privilege: a non-owner may only grant (or manage someone holding)
 * permissions that the actor itself holds.
 */
export function assertCanGrant(actor: Membership, permissions: readonly Permission[]): void {
  if (actor.role === "owner") return;
  if (permissions.some((p) => !actor.permissions.includes(p))) {
    throw new ForbiddenError("You cannot grant or manage permissions you do not have");
  }
}
