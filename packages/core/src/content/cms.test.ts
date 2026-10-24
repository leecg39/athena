import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { users, orgMembers, websiteMembers, customRoles, publishTargets, contentItems } from "@athena/db";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { decryptSecret } from "../integrations/crypto";
import { DomainError, ForbiddenError } from "../org/errors";
import { createContentItem, saveContentVersion, upsertPublishTarget, listPublishTargets, publishContentItem, exportContentPayload, markContentPublished, type CmsRequest } from "./index";

const KEY = "test-integrations-key-0123456789abcdef";

describe("CMS publishing", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let contentId: string;
  const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const reply = (status: number, body: unknown): CmsRequest => async (url, init) => {
    sent.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    return { status, body: JSON.stringify(body) };
  };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, { email: "cms-owner@example.com", name: "CMS Owner" });
    const site = await createWebsite(t.db, { organizationId, userId: user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: user.id, websiteId: site.id };
    const item = await createContentItem(t.db, { ...c, title: "Design tokens guide" });
    contentId = item.id;
    const [viewer] = await t.db.insert(users).values({ email: "cms-viewer@example.com", name: "Viewer" }).returning();
    const [role] = await t.db.insert(customRoles).values({ organizationId, name: "CMS Reader", permissions: ["websites:read", "content:read"] }).returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("stores credentials sealed, validates them and keeps secrets on masked resubmits", async () => {
    await expect(upsertPublishTarget(t.db, { ...c, provider: "wordpress", secretKey: KEY, config: { siteUrl: "http://127.0.0.1/wp" } })).rejects.toThrow(DomainError);
    await expect(upsertPublishTarget(t.db, { ...c, provider: "wordpress", secretKey: KEY, config: { siteUrl: "http://blog.canvasly.io" } })).rejects.toThrow(/https/);
    const wp = await upsertPublishTarget(t.db, { ...c, provider: "wordpress", secretKey: KEY, config: { siteUrl: "https://blog.canvasly.io/", username: "editor", applicationPassword: "abcd efgh ijkl" } });
    expect(wp).toMatchObject({ provider: "wordpress", configured: true, config: { siteUrl: "https://blog.canvasly.io", username: "editor", applicationPassword: "••••••••" } });
    const [row] = await t.db.select().from(publishTargets).where(eq(publishTargets.id, wp.id));
    expect(row.config.applicationPassword).toMatch(/^enc:/);
    expect(decryptSecret(row.config.applicationPassword.slice(4), KEY)).toBe("abcd efgh ijkl");
    await upsertPublishTarget(t.db, { ...c, provider: "wordpress", secretKey: KEY, config: { username: "editor2", applicationPassword: "••••••••" } });
    const [after] = await t.db.select().from(publishTargets).where(eq(publishTargets.id, wp.id));
    expect(decryptSecret(after.config.applicationPassword.slice(4), KEY)).toBe("abcd efgh ijkl");
    expect(after.config.username).toBe("editor2");
    await expect(upsertPublishTarget(t.db, { ...c, provider: "shopify", secretKey: KEY, config: { storeDomain: "evil.example.com", blogId: "1", accessToken: "x" } })).rejects.toThrow(/myshopify/);
    await upsertPublishTarget(t.db, { ...c, provider: "shopify", secretKey: KEY, config: { storeDomain: "canvasly.myshopify.com", blogId: "9001", accessToken: "shpat_123", blogHandle: "news" } });
    expect((await listPublishTargets(t.db, c)).map((x) => [x.provider, x.configured])).toEqual([["shopify", true], ["wordpress", true]]);
    // a legacy row never shows stored secrets (e.g. a plaintext token) or unknown keys, and the next save seals them
    await t.db.insert(publishTargets).values({ websiteId: c.websiteId, provider: "webflow", config: { apiToken: "plain-legacy-token", endpointUrl: "https://api.webflow.com/x" } });
    const legacy = (await listPublishTargets(t.db, c)).find((x) => x.provider === "webflow")!;
    expect(legacy).toMatchObject({ configured: false, config: { apiToken: "••••••••" } });
    expect(legacy.config.endpointUrl).toBeUndefined();
    const resaved = await upsertPublishTarget(t.db, { ...c, provider: "webflow", secretKey: KEY, config: { collectionId: "580e63fc8c9a982ac9b8b745" } });
    // empty fields take their defaults; the target is complete once every required field is set
    expect(resaved).toMatchObject({ configured: true, config: { apiToken: "••••••••", collectionId: "580e63fc8c9a982ac9b8b745", bodyField: "post-body" } });
    const [sealed] = await t.db.select().from(publishTargets).where(eq(publishTargets.id, legacy.id));
    expect(sealed.config.apiToken).toMatch(/^enc:/);
    expect(decryptSecret(sealed.config.apiToken.slice(4), KEY)).toBe("plain-legacy-token");
    expect(sealed.config.endpointUrl).toBeUndefined();
    await t.db.delete(publishTargets).where(eq(publishTargets.id, legacy.id));
    await expect(upsertPublishTarget(t.db, { ...c, provider: "webflow", secretKey: KEY, config: { urlPrefix: "https://other.example/blog" } })).rejects.toThrow(/own site/);
  });

  it("publishes to WordPress only when the site accepts the post", async () => {
    await expect(publishContentItem(t.db, { ...c, contentId, provider: "wordpress", secretKey: KEY, request: reply(201, {}) })).rejects.toThrow(/draft/i);
    await saveContentVersion(t.db, { ...c, contentId, body: "# Design tokens\n\nTokens keep **design** and code in sync." });
    await expect(publishContentItem(t.db, { ...c, contentId, provider: "wordpress", secretKey: KEY, request: reply(401, { message: "Sorry, you are not allowed to create posts." }) })).rejects.toThrow(/rejected.*401.*not allowed/);
    expect((await t.db.select().from(contentItems).where(eq(contentItems.id, contentId)))[0].status).not.toBe("published");

    const res = await publishContentItem(t.db, { ...c, contentId, provider: "wordpress", secretKey: KEY, request: reply(201, { id: 77, link: "https://blog.canvasly.io/design-tokens-guide/" }) });
    expect(res).toMatchObject({ publishedUrl: "https://blog.canvasly.io/design-tokens-guide/", publishedVersion: 1 });
    const req = sent.at(-1)!;
    expect(req.url).toBe("https://blog.canvasly.io/wp-json/wp/v2/posts");
    expect(req.headers.authorization).toBe(`Basic ${Buffer.from("editor2:abcd efgh ijkl").toString("base64")}`);
    expect(req.body).toEqual({ title: "Design tokens guide", status: "publish", slug: "design-tokens-guide", content: "<h1>Design tokens</h1>\n<p>Tokens keep <strong>design</strong> and code in sync.</p>" });
    const [item] = await t.db.select().from(contentItems).where(eq(contentItems.id, contentId));
    expect(item).toMatchObject({ status: "published", targetUrl: "https://blog.canvasly.io/design-tokens-guide/" });
    expect(item.columns).toMatchObject({ publishedProvider: "wordpress", remoteId: "77" });
  });

  it("publishes Shopify articles with the Admin API token", async () => {
    const res = await publishContentItem(t.db, { ...c, contentId, provider: "shopify", secretKey: KEY, request: reply(201, { article: { id: 555, handle: "design-tokens-guide", blog_id: 9001 } }) });
    expect(res.publishedUrl).toBe("https://canvasly.io/blogs/news/design-tokens-guide");
    const req = sent.at(-1)!;
    expect(req.url).toBe("https://canvasly.myshopify.com/admin/api/2025-01/blogs/9001/articles.json");
    expect(req.headers["x-shopify-access-token"]).toBe("shpat_123");
    expect(req.body).toMatchObject({ article: { title: "Design tokens guide", published: true } });
  });

  it("publishes to Sanity with the connection's defaults and refuses incomplete connections", async () => {
    await expect(publishContentItem(t.db, { ...c, contentId, provider: "sanity", secretKey: KEY, request: reply(200, {}) })).rejects.toThrow(/Connect Sanity first/);
    await upsertPublishTarget(t.db, { ...c, provider: "sanity", secretKey: KEY, config: { projectId: "zp7mbokg" } });
    await expect(publishContentItem(t.db, { ...c, contentId, provider: "sanity", secretKey: KEY, request: reply(200, {}) })).rejects.toThrow(/Finish the Sanity connection first \(missing: API token/);
    await upsertPublishTarget(t.db, { ...c, provider: "sanity", secretKey: KEY, config: { token: "skTok" } });
    await expect(publishContentItem(t.db, { ...c, contentId, provider: "sanity", secretKey: KEY, request: reply(401, { message: "Unauthorized - Session not found" }) })).rejects.toThrow(/Sanity rejected the post \(HTTP 401\)/);
    const res = await publishContentItem(t.db, { ...c, contentId, provider: "sanity", secretKey: KEY, request: reply(200, { results: [{ id: "doc-1", operation: "create" }] }) });
    expect(res).toMatchObject({ providerLabel: "Sanity", publishedUrl: null });
    const req = sent.at(-1)!;
    expect(req.url).toBe("https://zp7mbokg.api.sanity.io/v2025-02-19/data/mutate/production?returnIds=true&visibility=sync");
    expect((req.body as any).mutations[0].create).toMatchObject({ _type: "post", title: "Design tokens guide", slug: { current: "design-tokens-guide" }, body: [{ style: "h1" }, { style: "normal" }] });
    const [item] = await t.db.select().from(contentItems).where(eq(contentItems.id, contentId));
    expect(item.columns).toMatchObject({ publishedProvider: "sanity", remoteId: "doc-1" });
  });

  it("gives non-Latin titles their own slug instead of a shared fallback", async () => {
    const ko = await createContentItem(t.db, { ...c, title: "디자인 토큰 가이드" });
    await saveContentVersion(t.db, { ...c, contentId: ko.id, body: "디자인 토큰은 디자인과 코드를 맞춰 줍니다." });
    expect((await exportContentPayload(t.db, { ...c, contentId: ko.id, provider: "wordpress" })).filename).toBe(`post-${ko.id.replace(/-/g, "").slice(0, 8)}.wordpress.json`);
  });

  it("exports payloads for any CMS and marks pages published only when they are live", async () => {
    await expect(publishContentItem(t.db, { ...c, contentId, provider: "webflow", secretKey: KEY, request: reply(201, {}) })).rejects.toThrow(/Connect Webflow first/);
    const exported = await exportContentPayload(t.db, { ...c, contentId, provider: "webflow" });
    expect(exported.filename).toBe("design-tokens-guide.webflow.json");
    expect(JSON.parse(exported.body)).toMatchObject({ provider: "webflow", title: "Design tokens guide", slug: "design-tokens-guide", markdown: expect.stringContaining("# Design tokens"), html: expect.stringContaining("<h1>") });

    await expect(markContentPublished(t.db, { ...c, contentId, url: "https://other.example/x", page: { html: "<h1>Design tokens guide</h1>" } })).rejects.toThrow(/own site/);
    await expect(markContentPublished(t.db, { ...c, contentId, url: "https://canvasly.io/blog/tokens", page: { html: "<h1>Something else</h1>" } })).rejects.toThrow(/title/);
    const marked = await markContentPublished(t.db, { ...c, contentId, url: "https://canvasly.io/blog/tokens", page: { html: "<html><h1>Design Tokens   Guide</h1></html>" } });
    expect(marked).toMatchObject({ status: "published", targetUrl: "https://canvasly.io/blog/tokens" });
  });

  it("enforces RBAC", async () => {
    await expect(upsertPublishTarget(t.db, { actorId: viewerId, websiteId: c.websiteId, provider: "wordpress", secretKey: KEY, config: {} })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishContentItem(t.db, { actorId: viewerId, websiteId: c.websiteId, contentId, provider: "wordpress", secretKey: KEY, request: reply(201, {}) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportContentPayload(t.db, { actorId: viewerId, websiteId: c.websiteId, contentId, provider: "sanity" })).resolves.toBeTruthy();
  });
});
