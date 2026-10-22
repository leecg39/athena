import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { integrations } from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy/index";
import { ForbiddenError } from "../org/index";
import {
  encryptSecret,
  decryptSecret,
  signState,
  verifyState,
  gscAuthUrl,
  exchangeGscCode,
  listGscSites,
  matchGscProperty,
  saveGscConnection,
  getIntegration,
  disconnectIntegration,
  readGscCredentials,
} from "./index";

const KEY = "test-secret-key-material";

describe("secret encryption", () => {
  it("round-trips and detects tampering / wrong keys", () => {
    const token = encryptSecret('{"refresh_token":"r1"}', KEY);
    expect(token).not.toContain("r1");
    expect(decryptSecret(token, KEY)).toBe('{"refresh_token":"r1"}');
    expect(() => decryptSecret(token, "other-key")).toThrow();
    const parts = token.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0xff; // flip a real ciphertext byte (editing base64 chars may only touch padding bits)
    parts[3] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY)); // random IV
  });
});

describe("oauth state", () => {
  it("verifies signature, expiry and shape", () => {
    const now = 1_000_000_000_000;
    const s = signState({ websiteId: "w", userId: "u" }, KEY, now, 600);
    expect(verifyState(s, KEY, now + 1000)).toMatchObject({ websiteId: "w", userId: "u" });
    expect(verifyState(s, KEY, now + 601_000)).toBeNull();
    expect(verifyState(s, "wrong", now)).toBeNull();
    expect(verifyState(`${s}x`, KEY, now)).toBeNull();
    expect(verifyState("garbage", KEY, now)).toBeNull();
  });
});

describe("Search Console helpers", () => {
  it("builds an offline consent URL with the read-only scope", () => {
    const url = new URL(gscAuthUrl({ clientId: "cid", redirectUri: "https://app/cb", state: "st" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("st");
  });

  it("exchanges a code and lists sites", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        expect(String(init?.body)).toContain("grant_type=authorization_code");
        return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "x" });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer at");
      return Response.json({ siteEntry: [{ siteUrl: "sc-domain:canvasly.io", permissionLevel: "siteOwner" }] });
    });
    const tokens = await exchangeGscCode({ code: "c", clientId: "i", clientSecret: "s", redirectUri: "r", fetchImpl });
    expect(tokens.refresh_token).toBe("rt");
    expect(await listGscSites("at", fetchImpl)).toEqual([{ siteUrl: "sc-domain:canvasly.io", permissionLevel: "siteOwner" }]);
  });

  it("matches the property for a domain, ignoring unverified ones", () => {
    const sites = [
      { siteUrl: "https://other.com/", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.canvasly.io/", permissionLevel: "siteFullUser" },
      { siteUrl: "sc-domain:canvasly.io", permissionLevel: "siteUnverifiedUser" },
    ];
    expect(matchGscProperty(sites, "canvasly.io")).toBe("https://www.canvasly.io/");
    expect(matchGscProperty([{ siteUrl: "sc-domain:canvasly.io", permissionLevel: "siteOwner" }, ...sites], "canvasly.io")).toBe("sc-domain:canvasly.io");
    expect(matchGscProperty(sites, "nope.io")).toBeNull();
  });
});

describe("connection storage", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("stores the refresh token encrypted, upserts, and disconnects", async () => {
    const u = await ensureUserWithOrg(t.db, { email: "gsc@example.com" });
    const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
    await saveGscConnection(t.db, { actorId: u.user.id, websiteId: site.id, refreshToken: "rt-1", property: "sc-domain:canvasly.io", key: KEY });
    await saveGscConnection(t.db, { actorId: u.user.id, websiteId: site.id, refreshToken: "rt-2", property: "sc-domain:canvasly.io", key: KEY });
    const rows = await t.db.select().from(integrations).where(eq(integrations.websiteId, site.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].secret).not.toContain("rt-2");
    expect(readGscCredentials(rows[0], KEY).refreshToken).toBe("rt-2");
    const status = await getIntegration(t.db, site.id, "gsc");
    expect(status?.externalAccount).toBe("sc-domain:canvasly.io");
    expect(status).not.toHaveProperty("secret");
    await disconnectIntegration(t.db, { actorId: u.user.id, websiteId: site.id, provider: "gsc" });
    expect((await getIntegration(t.db, site.id, "gsc"))?.status).toBe("disconnected");
    const outsider = await ensureUserWithOrg(t.db, { email: "out-gsc@example.com" });
    await expect(saveGscConnection(t.db, { actorId: outsider.user.id, websiteId: site.id, refreshToken: "x", property: "p", key: KEY })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
