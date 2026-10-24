/**
 * Publishing: a direct publish succeeds only when the CMS accepts every request
 * of its flow (2xx); an export of the content is available for any other
 * workflow; "published" can also be set by hand, but only after the live page
 * is confirmed to show the content.
 */
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type Db, contentItems, contentVersions, publishTargets } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { CMS_PROVIDER_LABELS, CMS_PROVIDERS, type CmsProvider, normalizeContentUrl, slugify } from "./shared";
import { markdownToHtml } from "./html";
import { parseMarkdown } from "./markdown-ast";
import { openTargetConfig } from "./cms-targets";
import { PROVIDERS, type CmsPost, type CmsRequest, type FramerConnect } from "./cms-providers";
import { pageToDraft } from "./grounding";

export * from "./cms-targets";
export type { CmsRequest, FramerConnect, FramerProject, FramerCollectionRef } from "./cms-providers";

async function itemWithLatestVersion(db: Db, site: WebsiteRow, contentId: string) {
  if (!z.string().uuid().safeParse(contentId).success) throw new DomainError("Invalid content item ID");
  const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
  if (!item) throw new NotFoundError("Content item not found");
  const [version] = await db.select().from(contentVersions).where(eq(contentVersions.contentId, item.id)).orderBy(desc(contentVersions.version)).limit(1);
  return { item, version: version ?? null };
}

/** URL slug for an item; titles without Latin letters or digits get a stable id-based slug instead of a shared fallback. */
export function contentSlug(title: string, contentId: string): string {
  const slug = slugify(title);
  return slug === "article" && !/article/i.test(title) ? `post-${contentId.replace(/-/g, "").slice(0, 8)}` : slug;
}

const toPost = (title: string, slug: string, markdown: string): CmsPost => ({ title, slug, markdown, html: markdownToHtml(markdown), blocks: parseMarkdown(markdown), publishedAt: new Date().toISOString() });

export async function publishContentItem(
  db: Db,
  input: { actorId: string; websiteId: string; contentId: string; provider: CmsProvider; secretKey: string; request: CmsRequest; framer?: FramerConnect | null },
) {
  if (!(CMS_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainError("Unknown CMS");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const provider = input.provider;
  const { item, version } = await itemWithLatestVersion(db, site, input.contentId);
  if (!version) throw new DomainError("Write or generate a draft before publishing");
  const [target] = await db.select().from(publishTargets).where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, provider)));
  if (!target) throw new DomainError(`Connect ${CMS_PROVIDER_LABELS[provider]} first`);
  const missing = PROVIDERS[provider].fields.filter((f) => f.required && !target.config?.[f.key]);
  if (missing.length) throw new DomainError(`Finish the ${CMS_PROVIDER_LABELS[provider]} connection first (missing: ${missing.map((f) => f.label).join(", ")})`);
  const cfg = openTargetConfig(target, input.secretKey);
  const out = await PROVIDERS[provider].publish(toPost(item.title, contentSlug(item.title, item.id), version.body), { cfg, site, request: input.request, framer: input.framer ?? null });
  return db.transaction(async (tx) => {
    const columns = { ...(item.columns ?? {}), agentStage: "published", publishedProvider: provider, publishedUrl: out.url ?? "", publishedAt: new Date().toISOString(), publishedVersion: version.version, remoteId: out.remoteId ?? "" };
    const [updated] = await tx.update(contentItems).set({ status: "published", targetUrl: out.url ?? item.targetUrl, columns }).where(eq(contentItems.id, item.id)).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "content_item", entityId: item.id, change: "published_cms", after: { provider, status: out.status, remoteId: out.remoteId, url: out.url, version: version.version } });
    return { item: updated, provider, providerLabel: CMS_PROVIDER_LABELS[provider], publishedUrl: out.url, publishedVersion: version.version };
  });
}

/** The latest version prepared for one CMS, as a downloadable JSON file (no write). */
export async function exportContentPayload(db: Db, input: { actorId: string; websiteId: string; contentId: string; provider: CmsProvider }) {
  if (!(CMS_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainError("Unknown CMS");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const { item, version } = await itemWithLatestVersion(db, site, input.contentId);
  if (!version) throw new DomainError("Write or generate a draft before exporting");
  const slug = contentSlug(item.title, item.id);
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
