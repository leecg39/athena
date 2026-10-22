import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { creditBalances, orgMembers, websites } from "@athena/db";
import { DomainError } from "../org/errors";
import { eq } from "drizzle-orm";
import {
  ensureUserWithOrg,
  listWebsitesForUser,
  getWebsiteForUser,
  createWebsite,
  slugify,
} from "./index";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("slugify", () => {
  it("produces url-safe slugs", () => {
    expect(slugify("Acme Inc. 한국")).toBe("acme-inc");
    expect(slugify("  ")).toBe("org");
  });
});

describe("ensureUserWithOrg", () => {
  it("creates a user, a personal org with owner membership and free credits", async () => {
    const r = await ensureUserWithOrg(t.db, { email: "Alice@Example.com", name: "Alice" });
    expect(r.user.email).toBe("alice@example.com");
    expect(r.created).toBe(true);
    const members = await t.db.select().from(orgMembers).where(eq(orgMembers.userId, r.user.id));
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    const [bal] = await t.db.select().from(creditBalances).where(eq(creditBalances.organizationId, r.organizationId));
    expect(bal.balance).toBe(300);
  });

  it("is idempotent for an existing user", async () => {
    const a = await ensureUserWithOrg(t.db, { email: "bob@example.com" });
    const b = await ensureUserWithOrg(t.db, { email: "BOB@example.com" });
    expect(b.user.id).toBe(a.user.id);
    expect(b.organizationId).toBe(a.organizationId);
    expect(b.created).toBe(false);
  });

  it("rejects invalid email", async () => {
    await expect(ensureUserWithOrg(t.db, { email: "not-an-email" })).rejects.toThrow(/email/i);
  });
});

describe("websites access", () => {
  it("lists only websites of the user's orgs and enforces access", async () => {
    const carol = await ensureUserWithOrg(t.db, { email: "carol@example.com" });
    const dave = await ensureUserWithOrg(t.db, { email: "dave@example.com" });
    const site = await createWebsite(t.db, {
      organizationId: carol.organizationId,
      userId: carol.user.id,
      domain: "https://www.Canvasly.io/path",
      name: "Canvasly",
    });
    expect(site.domain).toBe("canvasly.io");

    const carolSites = await listWebsitesForUser(t.db, carol.user.id);
    expect(carolSites.map((s) => s.id)).toContain(site.id);
    expect(await listWebsitesForUser(t.db, dave.user.id)).toHaveLength(0);

    expect((await getWebsiteForUser(t.db, carol.user.id, site.id))?.id).toBe(site.id);
    expect(await getWebsiteForUser(t.db, dave.user.id, site.id)).toBeNull();
    expect(await getWebsiteForUser(t.db, carol.user.id, "not-a-uuid")).toBeNull();
  });

  it("rejects duplicate domains in the same organization and invalid domains with a domain error", async () => {
    const owner = await ensureUserWithOrg(t.db, { email: "dup@example.com" });
    await createWebsite(t.db, { organizationId: owner.organizationId, userId: owner.user.id, domain: "dup.io", name: "Dup" });
    await expect(createWebsite(t.db, { organizationId: owner.organizationId, userId: owner.user.id, domain: "https://www.DUP.io/", name: "Dup 2" })).rejects.toThrow(/already tracked/i);
    await expect(createWebsite(t.db, { organizationId: owner.organizationId, userId: owner.user.id, domain: "http://", name: "Bad" })).rejects.toBeInstanceOf(DomainError);
  });

  it("hides soft-deleted websites", async () => {
    const erin = await ensureUserWithOrg(t.db, { email: "erin@example.com" });
    const site = await createWebsite(t.db, {
      organizationId: erin.organizationId,
      userId: erin.user.id,
      domain: "erin.dev",
      name: "Erin",
    });
    await t.db.update(websites).set({ deletedAt: new Date() }).where(eq(websites.id, site.id));
    expect(await listWebsitesForUser(t.db, erin.user.id)).toHaveLength(0);
    expect(await getWebsiteForUser(t.db, erin.user.id, site.id)).toBeNull();
  });
});
