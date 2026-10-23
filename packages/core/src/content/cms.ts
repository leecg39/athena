/**
 * Publishing: a direct publish succeeds only when the CMS accepts the request
 * (2xx); other CMSs get an export of the content; "published" can also be set
 * by hand, but only after the live page is confirmed to show the content.
 */
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type Db, contentItems, contentVersions, publishTargets } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { CMS_PROVIDER_LABELS, CMS_PROVIDERS, type CmsProvider, normalizeContentUrl, slugify } from "./shared";
import { markdownToHtml } from "./html";
import { isDirect, openTargetConfig, type DirectProvider } from "./cms-targets";
import { pageToDraft } from "./grounding";

export * from "./cms-targets";

/** Outgoing HTTP for publishing (the web layer passes the SSRF-safe fetcher). */
export type CmsRequest = (url: string, init: { method: "GET" | "POST" | "PUT"; headers: Record<string, string>; body?: string }) => Promise<{ status: number; body: string }>;

const SHOPIFY_API_VERSION = "2025-01";

async function itemWithLatestVersion(db: Db, site: WebsiteRow, contentId: string) {
  if (!z.string().uuid().safeParse(contentId).success) throw new DomainError("Invalid content item ID");
  const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
  if (!item) throw new NotFoundError("Content item not found");
  const [version] = await db.select().from(contentVersions).where(eq(contentVersions.contentId, item.id)).orderBy(desc(contentVersions.version)).limit(1);
  return { item, version: version ?? null };
}

function buildRequest(provider: DirectProvider, cfg: Record<string, string>, title: string, html: string): { url: string; headers: Record<string, string>; body: unknown } {
  const slug = slugify(title);
  if (provider === "wordpress") {
    return {
      url: `${cfg.siteUrl}/wp-json/wp/v2/posts`,
      headers: { authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.applicationPassword}`).toString("base64")}`, "content-type": "application/json", accept: "application/json" },
      body: { title, status: "publish", slug, content: html },
    };
  }
  return {
    url: `https://${cfg.storeDomain}/admin/api/${SHOPIFY_API_VERSION}/blogs/${cfg.blogId}/articles.json`,
    headers: { "x-shopify-access-token": cfg.accessToken, "content-type": "application/json", accept: "application/json" },
    body: { article: { title, body_html: html, published: true } },
  };
}

function parseJson(body: string): Record<string, any> {
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Where the post lives and its id on the CMS, from the CMS's own response. */
function published(provider: DirectProvider, cfg: Record<string, string>, site: WebsiteRow, res: Record<string, any>): { url: string | null; remoteId: string | null } {
  if (provider === "wordpress") {
    const link = typeof res.link === "string" && /^https?:\/\//.test(res.link) ? res.link : null;
    return { url: link, remoteId: res.id != null ? String(res.id) : null };
  }
  const a = res.article ?? {};
  const url = cfg.blogHandle && typeof a.handle === "string" ? `https://${site.domain}/blogs/${cfg.blogHandle}/${a.handle}` : null;
  return { url, remoteId: a.id != null ? String(a.id) : null };
}

function rejection(provider: DirectProvider, status: number, res: Record<string, any>): DomainError {
  const raw = provider === "wordpress" ? res.message : res.errors;
  const detail = raw ? `: ${(typeof raw === "string" ? raw : JSON.stringify(raw)).slice(0, 200)}` : "";
  return new DomainError(`${CMS_PROVIDER_LABELS[provider]} rejected the post (HTTP ${status})${detail}`);
}

export async function publishContentItem(
  db: Db,
  input: { actorId: string; websiteId: string; contentId: string; provider: CmsProvider; secretKey: string; request: CmsRequest },
) {
  if (!(CMS_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainError("Unknown CMS");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  if (!isDirect(input.provider)) throw new DomainError(`${CMS_PROVIDER_LABELS[input.provider]} has no direct publishing yet — use Export, then mark the item published once it is live`);
  const provider = input.provider;
  const { item, version } = await itemWithLatestVersion(db, site, input.contentId);
  if (!version) throw new DomainError("Write or generate a draft before publishing");
  const [target] = await db.select().from(publishTargets).where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, provider)));
  if (!target) throw new DomainError(`Connect ${CMS_PROVIDER_LABELS[provider]} first`);
  const cfg = openTargetConfig(target, input.secretKey);
  const req = buildRequest(provider, cfg, item.title, markdownToHtml(version.body));
  let res: { status: number; body: string };
  try {
    res = await input.request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
  } catch {
    throw new DomainError(`Could not reach ${CMS_PROVIDER_LABELS[provider]}. Check the connection settings.`);
  }
  const json = parseJson(res.body);
  if (res.status < 200 || res.status >= 300) throw rejection(provider, res.status, json);
  const out = published(provider, cfg, site, json);
  return db.transaction(async (tx) => {
    const columns = { ...(item.columns ?? {}), agentStage: "published", publishedProvider: provider, publishedUrl: out.url ?? "", publishedAt: new Date().toISOString(), publishedVersion: version.version, remoteId: out.remoteId ?? "" };
    const [updated] = await tx.update(contentItems).set({ status: "published", targetUrl: out.url ?? item.targetUrl, columns }).where(eq(contentItems.id, item.id)).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "content_item", entityId: item.id, change: "published_cms", after: { provider, status: res.status, remoteId: out.remoteId, url: out.url, version: version.version } });
    return { item: updated, provider, providerLabel: CMS_PROVIDER_LABELS[provider], publishedUrl: out.url, publishedVersion: version.version };
  });
}

/** The latest version prepared for one CMS, as a downloadable JSON file (no write). */
export async function exportContentPayload(db: Db, input: { actorId: string; websiteId: string; contentId: string; provider: CmsProvider }) {
  if (!(CMS_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainError("Unknown CMS");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const { item, version } = await itemWithLatestVersion(db, site, input.contentId);
  if (!version) throw new DomainError("Write or generate a draft before exporting");
  const slug = slugify(item.title);
  const body = JSON.stringify({ provider: input.provider, title: item.title, slug, version: version.version, markdown: version.body, html: markdownToHtml(version.body) }, null, 2);
  return { filename: `${slug}.${input.provider}.json`, contentType: "application/json", body };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Marks content published at a URL of the brand's site once the live page shows its title. */
export async function markContentPublished(db: Db, input: { actorId: string; websiteId: string; contentId: string; url: string; page: { html: string } | null }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const url = normalizeContentUrl(input.url, site.domain);
  const host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  const own = site.domain.replace(/^www\./, "").toLowerCase();
  if (!url || (host !== own && !host.endsWith(`.${own}`))) throw new DomainError(`Use the live URL on your own site (${site.domain})`);
  const { item } = await itemWithLatestVersion(db, site, input.contentId);
  if (!input.page) throw new DomainError("The page could not be loaded. Check that it is public and try again.");
  const page = pageToDraft(input.page.html);
  if (!norm(`${page.title} ${page.body}`).includes(norm(item.title))) throw new DomainError(`The page at ${url} doesn't show this content's title yet`);
  return db.transaction(async (tx) => {
    const columns = { ...(item.columns ?? {}), agentStage: "published", publishedProvider: "manual", publishedUrl: url, publishedAt: new Date().toISOString(), verifiedLiveAt: new Date().toISOString() };
    const [updated] = await tx.update(contentItems).set({ status: "published", targetUrl: url, columns }).where(eq(contentItems.id, item.id)).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "content_item", entityId: item.id, change: "marked_published", after: { url } });
    return updated;
  });
}
