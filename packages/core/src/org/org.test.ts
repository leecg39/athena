import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { activityLog } from "@athena/db";
import { ensureUserWithOrg, createWebsite, listWebsitesForUser, getWebsiteForUser } from "../tenancy/index.js";
import {
  can,
  permissionsFor,
  ForbiddenError,
  getMembership,
  listMembers,
  changeMemberRole,
  removeMember,
  createCustomRole,
  createInvite,
  acceptInvite,
  revokeInvite,
  listInvites,
  createApiKey,
  verifyApiKey,
  revokeApiKey,
  listActivity,
  updateOrganization,
  updateProfile,
  bumpSessionVersion,
  getSessionVersion,
  createGroup,
  setWebsiteGroup,
  addGroupMember,
} from "./index.js";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

async function orgWithOwner(email: string) {
  const r = await ensureUserWithOrg(t.db, { email, name: email.split("@")[0] });
  return { ownerId: r.user.id, orgId: r.organizationId };
}

async function addMember(orgId: string, inviterId: string, email: string, role: "admin" | "member" | "billing" | "owner" = "member") {
  const { token } = await createInvite(t.db, { actorId: inviterId, organizationId: orgId, email, role });
  const u = await ensureUserWithOrg(t.db, { email });
  await acceptInvite(t.db, { token, userId: u.user.id });
  return u.user.id;
}

describe("rbac", () => {
  it("maps built-in roles to permissions", () => {
    expect(can("owner", "billing:write")).toBe(true);
    expect(can("admin", "billing:write")).toBe(false);
    expect(can("admin", "members:write")).toBe(true);
    expect(can("billing", "billing:write")).toBe(true);
    expect(can("billing", "prompts:write")).toBe(false);
    expect(can("member", "prompts:write")).toBe(true);
    expect(can("member", "members:write")).toBe(false);
  });
  it("custom roles only grant listed, known permissions", () => {
    expect(permissionsFor("custom", ["prompts:read", "bogus:perm"])).toEqual(["prompts:read"]);
    expect(can("custom", "prompts:write", ["prompts:read"])).toBe(false);
  });
});

describe("members & invites", () => {
  it("invite → accept adds membership with the invited role and logs activity", async () => {
    const { ownerId, orgId } = await orgWithOwner("own1@example.com");
    const memberId = await addMember(orgId, ownerId, "mem1@example.com", "admin");
    const m = await getMembership(t.db, memberId, orgId);
    expect(m?.role).toBe("admin");
    const log = await listActivity(t.db, { actorId: ownerId, organizationId: orgId });
    expect(log.map((l) => `${l.entityType}:${l.change}`)).toEqual(expect.arrayContaining(["invite:created", "member:joined"]));
  });

  it("rejects invite acceptance by a different email, expired or revoked tokens", async () => {
    const { ownerId, orgId } = await orgWithOwner("own2@example.com");
    const { token, invite } = await createInvite(t.db, { actorId: ownerId, organizationId: orgId, email: "x@example.com", role: "member" });
    const stranger = await ensureUserWithOrg(t.db, { email: "stranger@example.com" });
    await expect(acceptInvite(t.db, { token, userId: stranger.user.id })).rejects.toThrow(/different email/i);
    await revokeInvite(t.db, { actorId: ownerId, organizationId: orgId, inviteId: invite.id });
    const x = await ensureUserWithOrg(t.db, { email: "x@example.com" });
    await expect(acceptInvite(t.db, { token, userId: x.user.id })).rejects.toThrow(/invalid|expired/i);
    await expect(acceptInvite(t.db, { token: "nope", userId: x.user.id })).rejects.toThrow(/invalid|expired/i);
    expect((await listInvites(t.db, { actorId: ownerId, organizationId: orgId })).find((i) => i.id === invite.id)?.status).toBe("revoked");
  });

  it("members cannot invite; admins cannot grant owner", async () => {
    const { ownerId, orgId } = await orgWithOwner("own3@example.com");
    const memberId = await addMember(orgId, ownerId, "mem3@example.com", "member");
    const adminId = await addMember(orgId, ownerId, "adm3@example.com", "admin");
    await expect(createInvite(t.db, { actorId: memberId, organizationId: orgId, email: "y@example.com", role: "member" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvite(t.db, { actorId: adminId, organizationId: orgId, email: "y@example.com", role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeMemberRole(t.db, { actorId: adminId, organizationId: orgId, userId: memberId, role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
    await changeMemberRole(t.db, { actorId: adminId, organizationId: orgId, userId: memberId, role: "admin" });
    expect((await getMembership(t.db, memberId, orgId))?.role).toBe("admin");
  });

  it("cannot grant permissions the actor does not hold (no escalation)", async () => {
    const { ownerId, orgId } = await orgWithOwner("own3b@example.com");
    const adminId = await addMember(orgId, ownerId, "adm3b@example.com", "admin");
    const memberId = await addMember(orgId, ownerId, "mem3b@example.com", "member");
    // admins lack billing:write, so they cannot hand out the billing role or a role containing it
    await expect(changeMemberRole(t.db, { actorId: adminId, organizationId: orgId, userId: memberId, role: "billing" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvite(t.db, { actorId: adminId, organizationId: orgId, email: "b3b@example.com", role: "billing" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createCustomRole(t.db, { actorId: adminId, organizationId: orgId, name: "Payer", permissions: ["billing:write"] })).rejects.toBeInstanceOf(ForbiddenError);
    // a custom role holding members:write can only grant within its own permission set
    const manager = await createCustomRole(t.db, { actorId: ownerId, organizationId: orgId, name: "People", permissions: ["members:read", "members:write", "prompts:read"] });
    await changeMemberRole(t.db, { actorId: ownerId, organizationId: orgId, userId: memberId, role: "custom", customRoleId: manager.id });
    const target = await addMember(orgId, ownerId, "t3b@example.com", "member");
    // the built-in member role holds permissions "People" lacks → cannot manage that user at all
    await expect(changeMemberRole(t.db, { actorId: memberId, organizationId: orgId, userId: target, role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    const viewer = await createCustomRole(t.db, { actorId: ownerId, organizationId: orgId, name: "Viewer", permissions: ["prompts:read"] });
    await expect(changeMemberRole(t.db, { actorId: memberId, organizationId: orgId, userId: target, role: "custom", customRoleId: viewer.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(t.db, { actorId: memberId, organizationId: orgId, userId: target })).rejects.toBeInstanceOf(ForbiddenError);
    // once the target is within the actor's permissions, management is allowed
    await changeMemberRole(t.db, { actorId: ownerId, organizationId: orgId, userId: target, role: "custom", customRoleId: viewer.id });
    const reader = await createCustomRole(t.db, { actorId: memberId, organizationId: orgId, name: "Reader", permissions: ["members:read"] });
    await changeMemberRole(t.db, { actorId: memberId, organizationId: orgId, userId: target, role: "custom", customRoleId: reader.id });
    expect((await getMembership(t.db, target, orgId))?.permissions).toEqual(["members:read"]);
  });

  it("protects the last owner from demotion and removal", async () => {
    const { ownerId, orgId } = await orgWithOwner("own4@example.com");
    await expect(changeMemberRole(t.db, { actorId: ownerId, organizationId: orgId, userId: ownerId, role: "admin" })).rejects.toThrow(/last owner/i);
    await expect(removeMember(t.db, { actorId: ownerId, organizationId: orgId, userId: ownerId })).rejects.toThrow(/last owner/i);
    const second = await addMember(orgId, ownerId, "own4b@example.com", "owner");
    await changeMemberRole(t.db, { actorId: ownerId, organizationId: orgId, userId: ownerId, role: "admin" });
    expect((await listMembers(t.db, { actorId: second, organizationId: orgId })).filter((m) => m.role === "owner")).toHaveLength(1);
  });

  it("custom roles validate permissions and are assignable", async () => {
    const { ownerId, orgId } = await orgWithOwner("own5@example.com");
    await expect(createCustomRole(t.db, { actorId: ownerId, organizationId: orgId, name: "x", permissions: ["nope:nope"] })).rejects.toThrow(/permission/i);
    const role = await createCustomRole(t.db, { actorId: ownerId, organizationId: orgId, name: "Analyst", permissions: ["prompts:read", "content:read"] });
    const uid = await addMember(orgId, ownerId, "an5@example.com", "member");
    await changeMemberRole(t.db, { actorId: ownerId, organizationId: orgId, userId: uid, role: "custom", customRoleId: role.id });
    const m = await getMembership(t.db, uid, orgId);
    expect(m?.permissions.sort()).toEqual(["content:read", "prompts:read"]);
  });
});

describe("website scoping", () => {
  it("org-wide roles see all websites; members only their website/group memberships", async () => {
    const { ownerId, orgId } = await orgWithOwner("own6@example.com");
    const a = await createWebsite(t.db, { organizationId: orgId, userId: ownerId, domain: "a6.io", name: "A" });
    const b = await createWebsite(t.db, { organizationId: orgId, userId: ownerId, domain: "b6.io", name: "B" });
    const c = await createWebsite(t.db, { organizationId: orgId, userId: ownerId, domain: "c6.io", name: "C" });
    const { token } = await createInvite(t.db, { actorId: ownerId, organizationId: orgId, email: "m6@example.com", role: "member", websiteId: a.id });
    const m = await ensureUserWithOrg(t.db, { email: "m6@example.com" });
    await acceptInvite(t.db, { token, userId: m.user.id });
    const group = await createGroup(t.db, { actorId: ownerId, organizationId: orgId, name: "Portfolio" });
    await setWebsiteGroup(t.db, { actorId: ownerId, organizationId: orgId, websiteId: b.id, groupId: group.id });
    await addGroupMember(t.db, { actorId: ownerId, organizationId: orgId, groupId: group.id, userId: m.user.id });

    const mine = (await listWebsitesForUser(t.db, m.user.id)).map((s) => s.name);
    expect(mine).toContain("A");
    expect(mine).toContain("B");
    expect(mine).not.toContain("C");
    expect(await getWebsiteForUser(t.db, m.user.id, c.id)).toBeNull();
    expect((await listWebsitesForUser(t.db, ownerId)).map((s) => s.name)).toEqual(expect.arrayContaining(["A", "B", "C"]));
  });
});

describe("activity pagination", () => {
  it("pages through rows that share a timestamp without skipping", async () => {
    const { ownerId, orgId } = await orgWithOwner("own11@example.com");
    const ts = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 5; i++) {
      await t.db.insert(activityLog).values({ organizationId: orgId, userId: ownerId, entityType: "test", change: `c${i}`, createdAt: ts });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const rows = (await listActivity(t.db, { actorId: ownerId, organizationId: orgId, limit: 2, cursor })).filter((r) => r.entityType === "test");
      if (!rows.length) break;
      seen.push(...rows.map((r) => r.change));
      const last = rows.at(-1)!;
      cursor = last.id;
    }
    expect(seen.sort()).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });
});

describe("api keys", () => {
  it("stores only a hash, verifies, and stops working once revoked", async () => {
    const { ownerId, orgId } = await orgWithOwner("own7@example.com");
    const { key, record } = await createApiKey(t.db, { actorId: ownerId, organizationId: orgId, name: "CI" });
    expect(key.startsWith("ath_")).toBe(true);
    expect(record.hashedKey).not.toContain(key);
    expect((await verifyApiKey(t.db, key))?.organizationId).toBe(orgId);
    expect(await verifyApiKey(t.db, "ath_wrong")).toBeNull();
    await revokeApiKey(t.db, { actorId: ownerId, organizationId: orgId, keyId: record.id });
    expect(await verifyApiKey(t.db, key)).toBeNull();
  });
  it("requires api:manage", async () => {
    const { ownerId, orgId } = await orgWithOwner("own8@example.com");
    const memberId = await addMember(orgId, ownerId, "m8@example.com", "member");
    await expect(createApiKey(t.db, { actorId: memberId, organizationId: orgId, name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("settings", () => {
  it("updates org name (settings:write) and profile; session version bumps", async () => {
    const { ownerId, orgId } = await orgWithOwner("own9@example.com");
    const memberId = await addMember(orgId, ownerId, "m9@example.com", "member");
    await expect(updateOrganization(t.db, { actorId: memberId, organizationId: orgId, name: "Hack" })).rejects.toBeInstanceOf(ForbiddenError);
    const org = await updateOrganization(t.db, { actorId: ownerId, organizationId: orgId, name: "Acme" });
    expect(org.name).toBe("Acme");
    const u = await updateProfile(t.db, { userId: memberId, name: "  Mia  ", jobTitle: "Analyst" });
    expect(u.name).toBe("Mia");
    expect(await getSessionVersion(t.db, memberId)).toBe(0);
    await bumpSessionVersion(t.db, memberId);
    expect(await getSessionVersion(t.db, memberId)).toBe(1);
  });
  it("non-members are forbidden from reading org data", async () => {
    const { orgId } = await orgWithOwner("own10@example.com");
    const outsider = await ensureUserWithOrg(t.db, { email: "out10@example.com" });
    await expect(listMembers(t.db, { actorId: outsider.user.id, organizationId: orgId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listActivity(t.db, { actorId: outsider.user.id, organizationId: orgId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
