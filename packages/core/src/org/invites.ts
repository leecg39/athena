import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { type Db, invites, orgMembers, websiteMembers, groupMembers, users, websites, groups, customRoles } from "@athena/db";
import { assertCanGrant, requirePermission } from "./access";
import { logActivity } from "./activity";
import { DomainError, ForbiddenError, NotFoundError } from "./errors";
import { ORG_ROLES, permissionsFor, type OrgRole } from "./rbac";

export const INVITE_TTL_DAYS = 7;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const inviteInput = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]),
  customRoleId: z.string().uuid().optional().nullable(),
  websiteId: z.string().uuid().optional().nullable(),
  groupId: z.string().uuid().optional().nullable(),
});

/** Creates a pending invite; the raw token is returned once (email/link) and only its hash is stored. */
export async function createInvite(db: Db, input: z.input<typeof inviteInput>) {
  const data = inviteInput.parse(input);
  const actor = await requirePermission(db, data.actorId, data.organizationId, "members:write");
  if (data.role === "owner" && actor.role !== "owner") throw new ForbiddenError();
  if (data.role === "custom" && !data.customRoleId) throw new DomainError("Choose a custom role");
  if (data.role === "custom" && data.customRoleId) {
    const [cr] = await db.select({ id: customRoles.id, permissions: customRoles.permissions }).from(customRoles)
      .where(and(eq(customRoles.id, data.customRoleId), eq(customRoles.organizationId, data.organizationId)));
    if (!cr) throw new NotFoundError("Custom role not found");
    assertCanGrant(actor, permissionsFor("custom", cr.permissions));
  } else {
    assertCanGrant(actor, permissionsFor(data.role));
  }
  if (data.websiteId) {
    const [w] = await db.select({ id: websites.id }).from(websites)
      .where(and(eq(websites.id, data.websiteId), eq(websites.organizationId, data.organizationId)));
    if (!w) throw new NotFoundError("Website not found");
  }
  if (data.groupId) {
    const [g] = await db.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.id, data.groupId), eq(groups.organizationId, data.organizationId)));
    if (!g) throw new NotFoundError("Group not found");
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  const invite = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(invites)
      .values({
        organizationId: data.organizationId,
        email: data.email,
        role: data.role,
        customRoleId: data.role === "custom" ? data.customRoleId ?? null : null,
        websiteId: data.websiteId ?? null,
        groupId: data.groupId ?? null,
        tokenHash: hashToken(token),
        inviterId: data.actorId,
        expiresAt,
      })
      .returning();
    await logActivity(tx, {
      organizationId: data.organizationId,
      userId: data.actorId,
      entityType: "invite",
      entityId: row.id,
      change: "created",
      after: { email: data.email, role: data.role },
    });
    return row;
  });
  return { token, invite };
}

export async function listInvites(db: Db, opts: { actorId: string; organizationId: string }) {
  await requirePermission(db, opts.actorId, opts.organizationId, "members:read");
  return db
    .select({ id: invites.id, email: invites.email, role: invites.role, status: invites.status, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
    .from(invites)
    .where(eq(invites.organizationId, opts.organizationId))
    .orderBy(desc(invites.createdAt))
    .limit(100);
}

export async function revokeInvite(db: Db, input: { actorId: string; organizationId: string; inviteId: string }) {
  await requirePermission(db, input.actorId, input.organizationId, "members:write");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(invites)
      .set({ status: "revoked" })
      .where(and(eq(invites.id, input.inviteId), eq(invites.organizationId, input.organizationId), eq(invites.status, "pending")))
      .returning();
    if (!row) throw new NotFoundError("Pending invite not found");
    await logActivity(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
      entityType: "invite",
      entityId: row.id,
      change: "revoked",
      before: { email: row.email },
    });
  });
}

/** Look up a usable invite by its raw token (pending and unexpired). */
export async function findInviteByToken(db: Db, token: string) {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, hashToken(token)), eq(invites.status, "pending"), gt(invites.expiresAt, new Date())));
  return row ?? null;
}

/** Accept an invite as `userId` (whose email must match the invite). Returns the organization id. */
export async function acceptInvite(db: Db, input: { token: string; userId: string }): Promise<string> {
  const invite = await findInviteByToken(db, input.token);
  if (!invite) throw new DomainError("This invite link is invalid or has expired");
  const [user] = await db.select().from(users).where(eq(users.id, input.userId));
  if (!user) throw new NotFoundError("User not found");
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new DomainError("This invite was sent to a different email address");
  }
  await db.transaction(async (tx) => {
    // keep an existing (possibly higher) role if the user is already a member
    await tx
      .insert(orgMembers)
      .values({ organizationId: invite.organizationId, userId: user.id, role: invite.role, customRoleId: invite.customRoleId })
      .onConflictDoNothing();
    if (invite.websiteId) {
      await tx.insert(websiteMembers).values({ websiteId: invite.websiteId, userId: user.id }).onConflictDoNothing();
    }
    if (invite.groupId) {
      await tx.insert(groupMembers).values({ groupId: invite.groupId, userId: user.id }).onConflictDoNothing();
    }
    await tx.update(invites).set({ status: "accepted" }).where(eq(invites.id, invite.id));
    await logActivity(tx, {
      organizationId: invite.organizationId,
      userId: user.id,
      entityType: "member",
      entityId: user.id,
      change: "joined",
      after: { role: invite.role, via: "invite" },
    });
  });
  return invite.organizationId;
}
