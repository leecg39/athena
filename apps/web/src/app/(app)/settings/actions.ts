"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import {
  updateOrganization,
  updateWebsiteSettings,
  deleteWebsite,
  updateProfile,
  bumpSessionVersion,
  createInvite,
  revokeInvite,
  changeMemberRole,
  removeMember,
  createCustomRole,
  deleteCustomRole,
  createApiKey,
  revokeApiKey,
  createGroup,
  setWebsiteGroup,
  type OrgRole,
} from "@athena/core/org";
import { requireWorkspace } from "@/lib/workspace";
import { signOut } from "@/lib/auth";
import { runAction, str, type ActionState } from "@/lib/action-state";
import { appBaseUrl, escapeHtml, sendEmail } from "@/lib/email";

async function ctx() {
  const ws = await requireWorkspace();
  return { actorId: ws.user.id, organizationId: ws.organizationId, websiteId: ws.websiteId, ws };
}

export async function saveOrganization(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await updateOrganization(db, { actorId: c.actorId, organizationId: c.organizationId, name: str(fd, "name") });
    revalidatePath("/settings/general");
  });
}

export async function saveWebsite(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await updateWebsiteSettings(db, {
      actorId: c.actorId,
      organizationId: c.organizationId,
      websiteId: c.websiteId,
      name: str(fd, "name"),
      country: str(fd, "country"),
      timezone: str(fd, "timezone"),
    });
    revalidatePath("/", "layout");
  });
}

export async function removeWebsite(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    if (str(fd, "confirm") !== c.ws.website.domain) return { ok: false, error: `Type ${c.ws.website.domain} to confirm` };
    await deleteWebsite(db, { actorId: c.actorId, organizationId: c.organizationId, websiteId: c.websiteId });
    revalidatePath("/", "layout");
    return { ok: true, message: "Website deleted" };
  });
}

export async function addGroup(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await createGroup(db, { actorId: c.actorId, organizationId: c.organizationId, name: str(fd, "name") });
    revalidatePath("/settings/general");
    return { ok: true, message: "Group created" };
  });
}

export async function assignGroup(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    const groupId = str(fd, "groupId") || null;
    await setWebsiteGroup(db, { actorId: c.actorId, organizationId: c.organizationId, websiteId: c.websiteId, groupId });
    revalidatePath("/settings/general");
  });
}

export async function saveProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await updateProfile(db, { userId: c.actorId, name: str(fd, "name"), jobTitle: str(fd, "jobTitle") });
    revalidatePath("/settings/profile");
  });
}

export async function signOutEverywhere(): Promise<void> {
  const c = await ctx();
  await bumpSessionVersion(db, c.actorId);
  await signOut({ redirectTo: "/login" });
}

export async function inviteMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    const scope = str(fd, "scope");
    const { token, invite } = await createInvite(db, {
      actorId: c.actorId,
      organizationId: c.organizationId,
      email: str(fd, "email"),
      role: str(fd, "role") as OrgRole,
      customRoleId: str(fd, "customRoleId") || null,
      websiteId: scope === "website" ? c.websiteId : null,
    });
    const link = `${await appBaseUrl()}/invite/${token}`;
    const sent = await sendEmail({
      to: invite.email,
      subject: `You're invited to ${c.ws.website.name} on Athenum`,
      html: `<p>You have been invited to join <strong>${escapeHtml(c.ws.website.name)}</strong> as ${escapeHtml(invite.role)}.</p><p><a href="${escapeHtml(link)}">Accept invitation</a> (expires in 7 days)</p>`,
    });
    revalidatePath("/settings/users");
    return sent
      ? { ok: true, message: `Invitation emailed to ${invite.email}` }
      : { ok: true, message: "Email delivery is not configured — share this link:", secret: link };
  });
}

export async function cancelInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await revokeInvite(db, { actorId: c.actorId, organizationId: c.organizationId, inviteId: str(fd, "inviteId") });
    revalidatePath("/settings/users");
    return { ok: true, message: "Invite revoked" };
  });
}

export async function updateRole(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    const raw = str(fd, "role");
    const [role, customRoleId] = raw.startsWith("custom:") ? ["custom", raw.slice(7)] : [raw, null];
    await changeMemberRole(db, {
      actorId: c.actorId,
      organizationId: c.organizationId,
      userId: str(fd, "userId"),
      role: role as OrgRole,
      customRoleId,
    });
    revalidatePath("/settings/users");
  });
}

export async function deleteMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await removeMember(db, { actorId: c.actorId, organizationId: c.organizationId, userId: str(fd, "userId") });
    revalidatePath("/settings/users");
    return { ok: true, message: "Member removed" };
  });
}

export async function addCustomRole(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await createCustomRole(db, {
      actorId: c.actorId,
      organizationId: c.organizationId,
      name: str(fd, "name"),
      permissions: fd.getAll("permissions").map(String),
    });
    revalidatePath("/settings/users");
    return { ok: true, message: "Role created" };
  });
}

export async function removeCustomRole(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await deleteCustomRole(db, { actorId: c.actorId, organizationId: c.organizationId, roleId: str(fd, "roleId") });
    revalidatePath("/settings/users");
    return { ok: true, message: "Role deleted" };
  });
}

export async function addApiKey(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    const { key } = await createApiKey(db, { actorId: c.actorId, organizationId: c.organizationId, name: str(fd, "name") });
    revalidatePath("/settings/api");
    return { ok: true, message: "API key created", secret: key };
  });
}

export async function disableApiKey(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const c = await ctx();
    await revokeApiKey(db, { actorId: c.actorId, organizationId: c.organizationId, keyId: str(fd, "keyId") });
    revalidatePath("/settings/api");
    return { ok: true, message: "Key revoked" };
  });
}
