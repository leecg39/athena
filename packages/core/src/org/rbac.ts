/**
 * Role-based access: organization roles (owner/admin/billing/member) plus
 * custom roles carrying an explicit permission list.
 */
export const PERMISSIONS = [
  "prompts:read",
  "prompts:write",
  "content:read",
  "content:write",
  "outreach:read",
  "outreach:write",
  "billing:read",
  "billing:write",
  "members:read",
  "members:write",
  "api:manage",
  "settings:write",
  "websites:write",
  "activity:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type OrgRole = "owner" | "admin" | "billing" | "member" | "custom";
export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "billing", "member", "custom"];

/** Roles that see every website in the organization. */
export const ORG_WIDE_ROLES: ReadonlySet<OrgRole> = new Set(["owner", "admin", "billing"]);

const ROLE_PERMISSIONS: Record<Exclude<OrgRole, "custom">, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== "billing:write"),
  billing: ["billing:read", "billing:write", "members:read", "activity:read", "prompts:read", "content:read", "outreach:read"],
  member: ["prompts:read", "prompts:write", "content:read", "content:write", "outreach:read", "outreach:write", "members:read"],
};

const KNOWN = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return KNOWN.has(value);
}

export function permissionsFor(role: OrgRole, customPermissions: readonly string[] = []): Permission[] {
  if (role === "custom") return customPermissions.filter(isPermission);
  return [...ROLE_PERMISSIONS[role]];
}

export function can(role: OrgRole, permission: Permission, customPermissions?: readonly string[]): boolean {
  return permissionsFor(role, customPermissions).includes(permission);
}
