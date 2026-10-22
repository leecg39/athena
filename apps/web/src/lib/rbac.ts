/**
 * RBAC helpers mirroring the observed model: organization-level roles
 * (owner/admin/billing/member/custom), group and website memberships,
 * custom roles with permission strings.
 */
export type OrgRole = "owner" | "admin" | "billing" | "member" | "custom";

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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<"owner" | "admin" | "billing" | "member", Permission[]> = {
  owner: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => !p.startsWith("billing:")),
  billing: ["billing:read", "billing:write", "members:read", "prompts:read", "content:read"],
  member: ["prompts:read", "prompts:write", "content:read", "content:write", "outreach:read"],
};

export function can(
  role: OrgRole | "custom",
  permission: Permission,
  customPermissions?: string[],
): boolean {
  if (role === "custom") return customPermissions?.includes(permission) ?? false;
  return ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]?.includes(permission) ?? false;
}

export function isBillingCapable(role: OrgRole): boolean {
  return role === "owner" || role === "billing" || role === "admin";
}
