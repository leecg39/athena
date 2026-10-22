import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";

let testDbInstance: TestDb;

vi.mock("@athena/db", async () => {
  const actual = await vi.importActual<typeof import("@athena/db")>("@athena/db");
  const dbProxy = new Proxy(
    {},
    {
      get(_target, prop, receiver) {
        return Reflect.get(testDbInstance.db as unknown as object, prop, receiver);
      },
    },
  );
  return {
    ...actual,
    db: dbProxy,
    getDb: () => testDbInstance.db,
  };
});

import { db, creditBalances, groups, organizations, users, orgMembers, websites } from "@athena/db";
import { createApiKey } from "@athena/core/org";
import { resetRateLimitBuckets } from "@/lib/api-key";
import { GET as getValidateKey } from "./validate-api-key/route";
import { POST as postWebsites } from "./websites/route";
import { POST as postPrompts } from "./prompts/route";
import { GET as getBasics } from "./basics/[entity]/route";
import { GET as getKb, POST as postKb } from "./kb/route";
import { GET as getBillingCredits } from "./billing/credits/route";
import { GET as getTeams } from "./teams/route";
import { GET as getConnector } from "./connectors/[provider]/route";

describe("Public REST API /api/v1/* (Task 21)", () => {
  beforeAll(async () => {
    testDbInstance = await createTestDb();
  });

  afterAll(async () => {
    await testDbInstance?.close();
  });

  beforeEach(() => {
    resetRateLimitBuckets();
  });

  async function seedOrgWithApiKey(suffix: string) {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${suffix}`;
    const [user] = await db
      .insert(users)
      .values({
        email: `api-test-${uid}@example.com`,
        name: `API Tester ${suffix}`,
      })
      .returning();

    const [org] = await db
      .insert(organizations)
      .values({
        name: `API Org ${suffix}`,
        slug: `api-org-${uid}`,
      })
      .returning();

    await db.insert(orgMembers).values({
      organizationId: org!.id,
      userId: user!.id,
      role: "owner",
    });

    const [grp] = await db
      .insert(groups)
      .values({
        organizationId: org!.id,
        name: `Portfolio ${suffix}`,
      })
      .returning();

    const [site] = await db
      .insert(websites)
      .values({
        organizationId: org!.id,
        groupId: grp!.id,
        name: `Brand ${suffix}`,
        domain: `brand-${uid}.example.com`,
      })
      .returning();

    await db.insert(creditBalances).values([
      { organizationId: org!.id, balance: 2500 },
      { organizationId: org!.id, websiteId: site!.id, balance: 300 },
      { organizationId: org!.id, groupId: grp!.id, balance: 450 },
    ]);

    const key = await createApiKey(db, {
      actorId: user!.id,
      organizationId: org!.id,
      name: `Key ${suffix}`,
    });

    return {
      user: user!,
      org: org!,
      group: grp!,
      site: site!,
      secret: key.key,
    };
  }

  it("authenticates via Bearer and X-API-Key, rejects invalid keys, and enforces 60 req/min rate limit", async () => {
    const a = await seedOrgWithApiKey("auth");

    // 1. Missing key -> 401
    const resMissing = await getValidateKey(
      new NextRequest("http://localhost:3000/api/v1/validate-api-key"),
    );
    expect(resMissing.status).toBe(401);

    // 2. Bearer token -> 200
    const resBearer = await getValidateKey(
      new NextRequest("http://localhost:3000/api/v1/validate-api-key", {
        headers: { Authorization: `Bearer ${a.secret}` },
      }),
    );
    expect(resBearer.status).toBe(200);
    const bodyBearer = await resBearer.json();
    expect(bodyBearer).toEqual({ valid: true, organizationId: a.org.id });

    // 3. X-API-Key header -> 200
    const resHeader = await getValidateKey(
      new NextRequest("http://localhost:3000/api/v1/validate-api-key", {
        headers: { "X-API-Key": a.secret },
      }),
    );
    expect(resHeader.status).toBe(200);

    // 4. Exhaust remaining 58 requests in the 60 req/min bucket -> 61st returns 429
    for (let i = 0; i < 58; i++) {
      const okRes = await getValidateKey(
        new NextRequest("http://localhost:3000/api/v1/validate-api-key", {
          headers: { Authorization: `Bearer ${a.secret}` },
        }),
      );
      expect(okRes.status).toBe(200);
    }

    const rateLimited = await getValidateKey(
      new NextRequest("http://localhost:3000/api/v1/validate-api-key", {
        headers: { Authorization: `Bearer ${a.secret}` },
      }),
    );
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(rateLimited.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(rateLimited.headers.get("Retry-After")).toBe("5");
  });

  it("enforces strict tenant isolation across /websites, /prompts, /basics/*, /kb, /teams, /billing/credits, and /connectors/*", async () => {
    const tenantA = await seedOrgWithApiKey("tenantA");
    const tenantB = await seedOrgWithApiKey("tenantB");

    const headersA = { Authorization: `Bearer ${tenantA.secret}`, "Content-Type": "application/json" };

    // 1. POST /api/v1/websites rejects attaching to Tenant B's groupId (404)
    const crossGroupRes = await postWebsites(
      new NextRequest("http://localhost:3000/api/v1/websites", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          domain: "sub.tenant-a.example.com",
          name: "Tenant A Sub",
          groupId: tenantB.group.id,
        }),
      }),
    );
    expect(crossGroupRes.status).toBe(404);

    // 2. POST /api/v1/prompts creates prompt + topic on Tenant A's website and rejects duplicate
    const createPromptRes = await postPrompts(
      new NextRequest("http://localhost:3000/api/v1/prompts", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          websiteId: tenantA.site.id,
          text: "What are the best AI visibility platforms for enterprise teams?",
          topicName: "Enterprise AEO",
          volumeEstimate: 1200,
        }),
      }),
    );
    expect(createPromptRes.status).toBe(201);
    const createdPrompt = (await createPromptRes.json()).data;
    expect(createdPrompt.text).toContain("best AI visibility platforms");
    expect(createdPrompt.topicId).toBeTruthy();

    const dupPromptRes = await postPrompts(
      new NextRequest("http://localhost:3000/api/v1/prompts", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          websiteId: tenantA.site.id,
          text: "what are the best ai visibility platforms for enterprise teams?",
        }),
      }),
    );
    expect(dupPromptRes.status).toBe(400);

    // 3. GET /api/v1/basics/[entity] supports all 6 taxonomy entities including tags & schedules
    for (const entity of ["topics", "competitors", "personas", "locations", "tags", "schedules"]) {
      const res = await getBasics(
        new NextRequest(`http://localhost:3000/api/v1/basics/${entity}?websiteId=${tenantA.site.id}`, {
          headers: headersA,
        }),
        { params: Promise.resolve({ entity }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
    }

    // Cross-tenant basics access -> 404
    const crossBasics = await getBasics(
      new NextRequest(`http://localhost:3000/api/v1/basics/topics?websiteId=${tenantB.site.id}`, {
        headers: headersA,
      }),
      { params: Promise.resolve({ entity: "topics" }) },
    );
    expect(crossBasics.status).toBe(404);

    // 4. POST & GET /api/v1/kb creates pillars and facts, and blocks javascript: XSS sourceUrl
    const xssKbRes = await postKb(
      new NextRequest("http://localhost:3000/api/v1/kb", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          websiteId: tenantA.site.id,
          kind: "fact",
          claim: "Brand tenantA offers SOC2 Type II compliance across all plans.",
          sourceUrl: "javascript:alert(1)",
        }),
      }),
    );
    expect(xssKbRes.status).toBe(400);

    const validKbRes = await postKb(
      new NextRequest("http://localhost:3000/api/v1/kb", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          websiteId: tenantA.site.id,
          kind: "fact",
          claim: "Brand tenantA offers SOC2 Type II compliance across all plans.",
          sourceUrl: "https://brand-a.example.com/security",
          status: "confirmed",
        }),
      }),
    );
    expect(validKbRes.status).toBe(201);

    const kbGetRes = await getKb(
      new NextRequest(`http://localhost:3000/api/v1/kb?websiteId=${tenantA.site.id}`, {
        headers: headersA,
      }),
    );
    expect(kbGetRes.status).toBe(200);
    const kbBody = await kbGetRes.json();
    expect(kbBody.meta.factsCount).toBe(1);
    expect(kbBody.data.facts[0].claim).toContain("SOC2 Type II");

    // 5. GET /api/v1/billing/credits returns multi-scope balances and summary
    const creditsRes = await getBillingCredits(
      new NextRequest("http://localhost:3000/api/v1/billing/credits?scope=all", {
        headers: headersA,
      }),
    );
    expect(creditsRes.status).toBe(200);
    const creditsBody = await creditsRes.json();
    expect(creditsBody.summary).toEqual({
      orgUnallocatedBalance: 2500,
      totalWebsiteCredits: 300,
      totalGroupCredits: 450,
      totalOrgWideCredits: 3250,
    });

    // 6. GET /api/v1/teams returns only Tenant A's members, groups, and websites
    const teamsRes = await getTeams(
      new NextRequest("http://localhost:3000/api/v1/teams", {
        headers: headersA,
      }),
    );
    expect(teamsRes.status).toBe(200);
    const teamsBody = await teamsRes.json();
    expect(teamsBody.meta.organizationId).toBe(tenantA.org.id);
    expect(teamsBody.data.members.some((m: { email: string }) => m.email === tenantA.user.email)).toBe(true);
    expect(teamsBody.data.members.some((m: { email: string }) => m.email === tenantB.user.email)).toBe(false);

    // 7. GET /api/v1/connectors/looker-studio (JSON) & /api/v1/connectors/power-bi (CSV)
    const lookerRes = await getConnector(
      new NextRequest(`http://localhost:3000/api/v1/connectors/looker-studio?websiteId=${tenantA.site.id}&days=7`, {
        headers: headersA,
      }),
      { params: Promise.resolve({ provider: "looker-studio" }) },
    );
    expect(lookerRes.status).toBe(200);
    const lookerBody = await lookerRes.json();
    expect(lookerBody.connector).toBe("looker-studio");
    expect(Array.isArray(lookerBody.schema)).toBe(true);
    expect(lookerBody.schema.length).toBe(10);

    const powerBiCsvRes = await getConnector(
      new NextRequest(`http://localhost:3000/api/v1/connectors/power-bi?websiteId=${tenantA.site.id}&days=7&format=csv`, {
        headers: headersA,
      }),
      { params: Promise.resolve({ provider: "power-bi" }) },
    );
    expect(powerBiCsvRes.status).toBe(200);
    expect(powerBiCsvRes.headers.get("Content-Type")).toContain("text/csv");
    const csvText = await powerBiCsvRes.text();
    expect(csvText.split("\n")[0]).toBe(
      "date,website_id,website_name,domain,mention_rate,citation_rate,share_of_voice,avg_position,responses_count,estimated_monthly_value_usd",
    );
  });
});
