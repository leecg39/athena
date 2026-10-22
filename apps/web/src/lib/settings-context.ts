import "server-only";
import { cache } from "react";
import { db } from "@athena/db";
import { getMembership, ForbiddenError, type Membership, type Permission } from "@athena/core/org";
import { requireWorkspace, type Workspace } from "./workspace";

export interface SettingsContext extends Workspace {
  membership: Membership;
  can: (p: Permission) => boolean;
}

export const getSettingsContext = cache(async (): Promise<SettingsContext> => {
  const ws = await requireWorkspace();
  const membership = await getMembership(db, ws.user.id, ws.organizationId);
  // website access can come from a group/website membership only for org members,
  // so a missing org membership here means the data is inconsistent: fail loudly.
  if (!membership) throw new ForbiddenError("Not a member of this organization");
  return { ...ws, membership, can: (p) => membership.permissions.includes(p) };
});
