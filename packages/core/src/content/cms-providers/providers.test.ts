import { describe, expect, it } from "vitest";
import { DomainError } from "../../org/errors";
import { markdownToHtml } from "../html";
import { parseMarkdown } from "../markdown-ast";
import { PROVIDERS } from "./index";
import type { CmsContext, CmsPost, CmsRequest } from "./types";

const MD = "# Design tokens\n\nTokens keep **design** in sync.";
const NOW = "2026-10-25T05:00:00.000Z";
const post: CmsPost = { title: "Design tokens guide", slug: "design-tokens-guide", markdown: MD, html: markdownToHtml(MD), blocks: parseMarkdown(MD), publishedAt: NOW };
type Call = { url: string; method: string; headers: Record<string, string>; body: any };

/** Answers requests in order and records them. */
function cms(...replies: [number, unknown][]) {
  const calls: Call[] = [];
  const request: CmsRequest = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const [status, body] = replies[calls.length - 1] ?? [500, {}];
    if (status === 0) throw new Error("socket hang up");
    return { status, body: JSON.stringify(body) };
  };
  return { calls, ctx: (cfg: Record<string, string>): CmsContext => ({ cfg, site: { domain: "canvasly.io" }, request, framer: null }) };
}

describe("Webflow", () => {
  const cfg = { apiToken: "wf_tok", collectionId: "580e63fc8c9a982ac9b8b745", bodyField: "post-body", urlPrefix: "https://canvasly.io/blog" };
  it("creates a live collection item and links it under the configured prefix", async () => {
    const { calls, ctx } = cms([202, { id: "42b720ef280c7a7a3be8cabe", fieldData: { slug: "design-tokens-guide" } }]);
    expect(await PROVIDERS.webflow.publish(post, ctx(cfg))).toEqual({ url: "https://canvasly.io/blog/design-tokens-guide", remoteId: "42b720ef280c7a7a3be8cabe", status: 202 });
    expect(calls[0]).toMatchObject({ url: "https://api.webflow.com/v2/collections/580e63fc8c9a982ac9b8b745/items/live", method: "POST", headers: { authorization: "Bearer wf_tok" } });
    expect(calls[0].body).toEqual({ isArchived: false, isDraft: false, fieldData: { name: "Design tokens guide", slug: "design-tokens-guide", "post-body": post.html } });
  });
  it("reports Webflow's validation message and has no URL without a prefix", async () => {
    await expect(PROVIDERS.webflow.publish(post, cms([400, { code: "validation_error", message: "Validation Error", details: [{ param: "slug", description: "Unique value is already in database" }] }]).ctx(cfg))).rejects.toThrow(/Webflow rejected the post \(HTTP 400\): Validation Error.*Unique value/);
    expect((await PROVIDERS.webflow.publish(post, cms([202, { id: "a1" }]).ctx({ ...cfg, urlPrefix: "" }))).url).toBeNull();
  });
});

describe("Contentful", () => {
  const cfg = { managementToken: "CFPAT-x", spaceId: "yadj1kx9rmg0", environmentId: "master", contentTypeId: "blogPost", titleField: "title", bodyField: "body", bodyFormat: "markdown", slugField: "slug", locale: "en-US", region: "us", urlPrefix: "" };
  const created = [201, { sys: { id: "5KsDBWseXY6QegucYAoacS", version: 1 } }] as [number, unknown];
  it("creates the entry, then publishes that version", async () => {
    const { calls, ctx } = cms(created, [200, { sys: { publishedVersion: 2 } }]);
    expect(await PROVIDERS.contentful.publish(post, ctx(cfg))).toEqual({ url: null, remoteId: "5KsDBWseXY6QegucYAoacS", status: 200 });
    expect(calls[0]).toMatchObject({ url: "https://api.contentful.com/spaces/yadj1kx9rmg0/environments/master/entries", method: "POST", headers: { authorization: "Bearer CFPAT-x", "content-type": "application/vnd.contentful.management.v1+json", "x-contentful-content-type": "blogPost" } });
    expect(calls[0].body).toEqual({ fields: { title: { "en-US": "Design tokens guide" }, slug: { "en-US": "design-tokens-guide" }, body: { "en-US": MD } } });
    const dated = cms(created, [200, {}]);
    await PROVIDERS.contentful.publish(post, dated.ctx({ ...cfg, dateField: "publishDate" }));
    expect(dated.calls[0].body.fields.publishDate).toEqual({ "en-US": NOW });
    expect(calls[1]).toMatchObject({ url: "https://api.contentful.com/spaces/yadj1kx9rmg0/environments/master/entries/5KsDBWseXY6QegucYAoacS/published", method: "PUT", headers: { "x-contentful-version": "1" } });
  });
  it("sends Rich Text documents and uses the EU host when chosen", async () => {
    const { calls, ctx } = cms(created, [200, {}]);
    await PROVIDERS.contentful.publish(post, ctx({ ...cfg, bodyFormat: "richtext", region: "eu", slugField: "" }));
    expect(calls[0].url).toMatch(/^https:\/\/api\.eu\.contentful\.com\//);
    expect(Object.keys(calls[0].body.fields)).toEqual(["title", "body"]);
    expect(calls[0].body.fields.body["en-US"]).toMatchObject({ nodeType: "document", content: [{ nodeType: "heading-1" }, { nodeType: "paragraph" }] });
  });
  it("removes the draft when publishing is rejected, and says so", async () => {
    const invalid = [422, { sys: { id: "ValidationFailed" }, message: "Validation error", details: { errors: [{ name: "required", path: ["fields", "summary"] }] } }] as [number, unknown];
    const removedRun = cms(created, invalid, [204, {}]);
    await expect(PROVIDERS.contentful.publish(post, removedRun.ctx(cfg))).rejects.toThrow(/rejected publishing \(HTTP 422\): Validation error.*summary.*draft created in Contentful was removed/);
    expect(removedRun.calls[2]).toMatchObject({ method: "DELETE", url: expect.stringMatching(/\/entries\/5KsDBWseXY6QegucYAoacS$/), headers: { "x-contentful-version": "1" } });
    await expect(PROVIDERS.contentful.publish(post, cms(created, invalid, [500, {}]).ctx(cfg))).rejects.toThrow(/draft 5KsDBWseXY6QegucYAoacS is still in Contentful/);
    await expect(PROVIDERS.contentful.publish(post, cms([403, { message: "Forbidden" }]).ctx(cfg))).rejects.toThrow(/Contentful rejected the post \(HTTP 403\): Forbidden/);
    // a publish request that never gets an answer still cleans up the draft
    const lost = cms(created, [0, {}], [204, {}]);
    await expect(PROVIDERS.contentful.publish(post, lost.ctx(cfg))).rejects.toThrow(/Could not reach Contentful.*draft created in Contentful was removed/);
    expect(lost.calls[2].method).toBe("DELETE");
  });
});

describe("Sanity", () => {
  const cfg = { projectId: "zp7mbokg", dataset: "production", token: "skTok", documentType: "post", titleField: "title", slugField: "slug", bodyField: "body", bodyFormat: "portableText", urlPrefix: "https://canvasly.io/blog" };
  it("creates a published document (no drafts. prefix) with Portable Text", async () => {
    const { calls, ctx } = cms([200, { transactionId: "t1", results: [{ id: "a1b2c3", operation: "create" }] }]);
    expect(await PROVIDERS.sanity.publish(post, ctx(cfg))).toEqual({ url: "https://canvasly.io/blog/design-tokens-guide", remoteId: "a1b2c3", status: 200 });
    expect(calls[0]).toMatchObject({ url: "https://zp7mbokg.api.sanity.io/v2025-02-19/data/mutate/production?returnIds=true&visibility=sync", method: "POST", headers: { authorization: "Bearer skTok" } });
    const doc = calls[0].body.mutations[0].create;
    expect(doc).toMatchObject({ _type: "post", title: "Design tokens guide", slug: { _type: "slug", current: "design-tokens-guide" } });
    expect(doc._id).toBeUndefined();
    expect(doc.publishedAt).toBeUndefined();
    const dated = cms([200, { results: [{ id: "d" }] }]);
    await PROVIDERS.sanity.publish(post, dated.ctx({ ...cfg, dateField: "publishedAt" }));
    expect(dated.calls[0].body.mutations[0].create.publishedAt).toBe(NOW);
    expect(doc.body[0]).toMatchObject({ _type: "block", style: "h1" });
  });
  it("can store Markdown instead, and reports mutation errors", async () => {
    const { calls, ctx } = cms([200, { results: [{ id: "x" }] }]);
    await PROVIDERS.sanity.publish(post, ctx({ ...cfg, bodyFormat: "markdown" }));
    expect(calls[0].body.mutations[0].create.body).toBe(MD);
    await expect(PROVIDERS.sanity.publish(post, cms([403, { error: { description: "Insufficient permissions; permission \"create\" required" } }]).ctx(cfg))).rejects.toThrow(/Sanity rejected the post \(HTTP 403\): Insufficient permissions/);
  });
});

describe("Wix", () => {
  const cfg = { apiKey: "IST.eyJraWQiOi", siteId: "2d24cb8a-adcc-466a-ab59-fa74e0889a37", memberId: "8a8b9b73-4da8-47a5-8268-4396e68a0605" };
  const converted = [200, { document: { nodes: [{ type: "PARAGRAPH", id: "", nodes: [] }] } }] as [number, unknown];
  const drafted = [200, { draftPost: { id: "894a58a2-dc75-422d-9ca6-00a489750dfd", url: { base: "https://canvasly.io/blog", path: "/post/design-tokens-guide" } } }] as [number, unknown];
  it("converts the HTML to Ricos, creates the draft post, then publishes it", async () => {
    const { calls, ctx } = cms(converted, drafted, [200, { postId: "894a58a2-dc75-422d-9ca6-00a489750dfd" }]);
    expect(await PROVIDERS.wix.publish(post, ctx(cfg))).toEqual({ url: "https://canvasly.io/blog/post/design-tokens-guide", remoteId: "894a58a2-dc75-422d-9ca6-00a489750dfd", status: 200 });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "https://www.wixapis.com/ricos/v1/ricos-document/convert/to-ricos"],
      ["POST", "https://www.wixapis.com/blog/v3/draft-posts"],
      ["POST", "https://www.wixapis.com/blog/v3/draft-posts/894a58a2-dc75-422d-9ca6-00a489750dfd/publish"],
    ]);
    expect(calls.every((c) => c.headers.authorization === "IST.eyJraWQiOi" && c.headers["wix-site-id"] === cfg.siteId)).toBe(true);
    expect(calls[0].body).toMatchObject({ html: post.html, options: { plugins: expect.arrayContaining(["HEADING", "LINK"]) } });
    expect(calls[1].body).toEqual({ draftPost: { title: "Design tokens guide", memberId: cfg.memberId, seoSlug: "design-tokens-guide", richContent: { nodes: [{ type: "PARAGRAPH", id: "", nodes: [] }] } }, fieldsets: ["URL"] });
  });
  it("deletes the draft when publishing fails and refuses drafts Wix can't convert", async () => {
    const run = cms(converted, drafted, [403, { message: "Missing Post Owner" }], [200, {}]);
    await expect(PROVIDERS.wix.publish(post, run.ctx(cfg))).rejects.toThrow(/Wix rejected publishing \(HTTP 403\): Missing Post Owner. The draft created in Wix was removed/);
    expect(run.calls[3]).toMatchObject({ method: "DELETE", url: "https://www.wixapis.com/blog/v3/draft-posts/894a58a2-dc75-422d-9ca6-00a489750dfd" });
    const lost = cms(converted, drafted, [0, {}], [500, {}]);
    await expect(PROVIDERS.wix.publish(post, lost.ctx(cfg))).rejects.toThrow(/Could not reach Wix.*draft 894a58a2-dc75-422d-9ca6-00a489750dfd is still in Wix/);
    const long = { ...post, html: "x".repeat(30_001) };
    await expect(PROVIDERS.wix.publish(long, cms().ctx(cfg))).rejects.toThrow(/30,000 characters/);
  });
});

describe("Payload", () => {
  const cfg = { serverUrl: "https://cms.canvasly.io", collection: "posts", authCollection: "users", apiKey: "k-123", titleField: "title", slugField: "slug", bodyField: "content", bodyFormat: "lexical", dateField: "publishedAt", urlPrefix: "" };
  it("creates a published document with Lexical content using the API key header", async () => {
    const { calls, ctx } = cms([201, { doc: { id: 17, slug: "design-tokens-guide" }, message: "Post successfully created." }]);
    expect(await PROVIDERS.payload.publish(post, ctx(cfg))).toEqual({ url: null, remoteId: "17", status: 201 });
    expect(calls[0]).toMatchObject({ url: "https://cms.canvasly.io/api/posts", method: "POST", headers: { authorization: "users API-Key k-123" } });
    expect(calls[0].body).toMatchObject({ title: "Design tokens guide", slug: "design-tokens-guide", publishedAt: NOW, _status: "published", content: { root: { type: "root", children: [{ type: "heading", tag: "h1" }, { type: "paragraph" }] } } });
    expect(PROVIDERS.payload.fields.find((f) => f.key === "dateField")?.defaultValue).toBe("publishedAt");
  });
  it("reports which fields Payload rejected", async () => {
    await expect(PROVIDERS.payload.publish(post, cms([400, { errors: [{ name: "ValidationError", message: "The following field is invalid: Title", data: { errors: [{ path: "title", message: "This field is required." }] } }] }]).ctx(cfg))).rejects.toThrow(/Payload CMS rejected the post \(HTTP 400\): The following field is invalid: Title.*title: This field is required/);
  });
});

describe("Framer", () => {
  function project(opts: { pending?: { path: string; status: string }[]; deployStatus?: string; later?: string[]; managedBy?: string; deployFails?: boolean; publishFails?: boolean } = {}) {
    const log: string[] = [];
    let items: { id: string; slug: string }[] = [{ id: "old1", slug: "older-post" }];
    const added: unknown[] = [];
    const collection = {
      id: "col1", name: "Blog", managedBy: opts.managedBy ?? "user",
      getFields: async () => [{ id: "f1", name: "Title", type: "string" }, { id: "f2", name: "Content", type: "formattedText" }, { id: "f3", name: "Cover", type: "image" }],
      getItems: async () => items,
      addItems: async (input: { slug: string }[]) => { added.push(...input); items = [...items, { id: "new1", slug: input[0].slug }]; log.push("addItems"); },
    };
    const pending = opts.pending ?? [];
    const later = [...(opts.later ?? [])];
    const p = {
      getCollections: async () => [collection],
      // the new item's page shows up as an added page until the site is published
      getUnpublishedPageChanges: async () => (items.length > 1 ? [...pending, { path: "/blog/design-tokens-guide", status: "added" }] : pending),
      publish: async () => { log.push("publish"); if (opts.publishFails) throw new Error("Not allowed to publish"); return { deployment: { id: "dep1", status: opts.deployStatus ?? "pending", ...(opts.deployStatus === "failed" ? { failureStage: "publish" } : {}) }, hostnames: [{ hostname: "canvasly.framer.website", type: "default", isPrimary: false, isPublished: true }] }; },
      getDeployment: async (id: string) => { log.push(`poll:${id}`); return { id, status: later.shift() ?? "pending" }; },
      deploy: async (id: string) => { log.push(`deploy:${id}`); if (opts.deployFails) throw new Error("No permission to deploy"); return [{ hostname: "canvasly.io", type: "custom", isPrimary: true, isPublished: true }]; },
      disconnect: async () => { log.push("disconnect"); },
    };
    return { p, log, added };
  }
  const cfg = { projectId: "aabbccddeeff00112233", apiKey: "fr_key", collection: "Blog", titleField: "Title", bodyField: "Content", urlPrefix: "" };
  const ctxWith = (p: unknown, over: Record<string, string> = {}): CmsContext => ({ cfg: { ...cfg, ...over }, site: { domain: "canvasly.io" }, request: async () => ({ status: 500, body: "" }), framer: async () => p as never, sleep: async () => undefined });

  it("adds the CMS item, publishes, promotes to the custom domain and disconnects", async () => {
    const { p, log, added } = project({ later: ["optimizing"] });
    expect(await PROVIDERS.framer.publish(post, ctxWith(p))).toEqual({ url: "https://canvasly.io/blog/design-tokens-guide", remoteId: "new1", status: null });
    expect(added).toEqual([{ slug: "design-tokens-guide", fieldData: { f1: { type: "string", value: "Design tokens guide" }, f2: { type: "formattedText", value: post.html, contentType: "html" } } }]);
    // the deployment is followed until it leaves "pending" before the post counts as live
    expect(log).toEqual(["addItems", "publish", "poll:dep1", "deploy:dep1", "disconnect"]);
  });
  it("does not report a post as published while Framer is still deploying", async () => {
    const stuck = project({ later: [] });
    await expect(PROVIDERS.framer.publish(post, ctxWith(stuck.p))).rejects.toThrow(/still publishing.*added to the Blog collection/);
    expect(stuck.log.filter((l) => l.startsWith("poll")).length).toBeGreaterThan(3);
    expect(stuck.log).not.toContain("deploy:dep1");
    // promoting to the custom domain can fail after a production publish: the default domain is live, so that counts
    const promoted = project({ later: ["ready"], deployFails: true });
    expect(await PROVIDERS.framer.publish(post, ctxWith(promoted.p))).toMatchObject({ url: "https://canvasly.framer.website/blog/design-tokens-guide" });
  });
  it("refuses to publish someone else's unpublished changes, and never leaves the connection open", async () => {
    const { p, log } = project({ pending: [{ path: "/pricing", status: "updated" }] });
    await expect(PROVIDERS.framer.publish(post, ctxWith(p))).rejects.toThrow(/1 unpublished page change/);
    expect(log).toEqual(["disconnect"]);
  });
  it("explains missing collections or fields and failed deployments", async () => {
    await expect(PROVIDERS.framer.publish(post, ctxWith(project().p, { collection: "News" }))).rejects.toThrow(/No CMS collection "News".*Blog/);
    await expect(PROVIDERS.framer.publish(post, ctxWith(project().p, { bodyField: "Cover" }))).rejects.toThrow(/formatted text field "Cover".*Content/);
    await expect(PROVIDERS.framer.publish(post, ctxWith(project({ managedBy: "anotherPlugin" }).p))).rejects.toThrow(/managed by a plugin/);
    const failed = project({ deployStatus: "failed" });
    await expect(PROVIDERS.framer.publish(post, ctxWith(failed.p))).rejects.toThrow(/couldn't publish the site.*added to the Blog collection/);
    expect(failed.log.at(-1)).toBe("disconnect");
    await expect(PROVIDERS.framer.publish(post, { ...ctxWith(project().p), framer: null })).rejects.toThrow(DomainError);
    const denied = project({ publishFails: true });
    await expect(PROVIDERS.framer.publish(post, ctxWith(denied.p))).rejects.toThrow(/added the post to the Blog collection but couldn't publish the site: Not allowed to publish/);
    expect(denied.log.at(-1)).toBe("disconnect");
  });
});

describe("connection fields", () => {
  const site = { domain: "canvasly.io" };
  const field = (provider: keyof typeof PROVIDERS, key: string) => PROVIDERS[provider].fields.find((f) => f.key === key)!;
  it("normalizes ids and URLs and rejects values that can't work", () => {
    expect(field("framer", "projectId").parse("https://framer.com/projects/Website--aabbccddeeff00112233?node=x", site)).toBe("aabbccddeeff00112233");
    expect(() => field("framer", "projectId").parse("https://evil.example/projects/x", site)).toThrow(DomainError);
    expect(() => field("webflow", "collectionId").parse("not-an-id", site)).toThrow(/collection ID/);
    expect(field("webflow", "urlPrefix").parse("https://www.canvasly.io/blog/", site)).toBe("https://www.canvasly.io/blog");
    expect(() => field("webflow", "urlPrefix").parse("https://other.example/blog", site)).toThrow(/own site/);
    expect(() => field("sanity", "token").parse("sk tok\nen", site)).toThrow(DomainError);
    expect(() => field("payload", "serverUrl").parse("https://127.0.0.1", site)).toThrow(DomainError);
    expect(() => field("contentful", "region").parse("apac", site)).toThrow(/us, eu/);
  });
});
