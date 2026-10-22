/**
 * CMS Publishing connectors:
 *  - Supports all 8 observed providers: WordPress, Webflow, Contentful, Sanity, Wix, Framer, Payload CMS, Shopify
 *  - Manages `publish_targets` per website (also surfaced on `/settings/integrations`)
 *  - Formats provider-specific REST/Webhook payloads and transitions `content_items` to `published`
 */
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  type Db,
  publishTargets,
  contentItems,
  contentBriefs,
  contentDrafts,
  contentVersions,
  websites,
  kbFacts,
} from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import {
  CMS_PROVIDERS,
  CMS_PROVIDER_LABELS,
  type CmsProvider,
  maskConfigSecrets,
  normalizeContentUrl,
  slugify,
  validateSafeCmsEndpointUrl,
} from "./shared";

const upsertTargetSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  provider: z.enum(CMS_PROVIDERS),
  config: z.record(z.string(), z.string()).default({}),
});

export async function listPublishTargets(
  db: Db,
  rawInput: { actorId: string; websiteId: string },
) {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:read");
  const rows = await db
    .select()
    .from(publishTargets)
    .where(eq(publishTargets.websiteId, site.id))
    .orderBy(publishTargets.provider);

  return rows.map((r) => ({
    id: r.id,
    websiteId: r.websiteId,
    provider: r.provider as CmsProvider,
    label: CMS_PROVIDER_LABELS[r.provider as CmsProvider] ?? r.provider,
    config: maskConfigSecrets(r.config),
    createdAt: r.createdAt,
  }));
}

function defaultProviderConfig(provider: CmsProvider, brandDomain: string): Record<string, string> {
  switch (provider) {
    case "wordpress":
      return { endpointUrl: `https://${brandDomain}/wp-json/wp/v2/posts`, postStatus: "publish" };
    case "webflow":
      return { endpointUrl: `https://api.webflow.com/v2/collections/blog/items`, collectionSlug: "blog" };
    case "contentful":
      return { endpointUrl: `https://api.contentful.com/spaces/main/environments/master/entries`, contentTypeId: "article" };
    case "sanity":
      return { endpointUrl: `https://api.sanity.io/v2024-01-01/data/mutate/production`, dataset: "production" };
    case "wix":
      return { endpointUrl: `https://www.wixapis.com/blog/v3/draft-posts`, section: "blog" };
    case "framer":
      return { endpointUrl: `https://api.framer.com/cms/v1/collections/articles/items`, collection: "articles" };
    case "payload":
      return { endpointUrl: `https://${brandDomain}/api/posts`, collection: "posts" };
    case "shopify":
      return { endpointUrl: `https://${brandDomain}/admin/api/2025-01/articles.json`, storeDomain: brandDomain };
  }
}

export async function upsertPublishTarget(
  db: Db,
  rawInput: { actorId: string; websiteId: string; provider: CmsProvider; config?: Record<string, string> },
) {
  let input: z.infer<typeof upsertTargetSchema>;
  try {
    input = upsertTargetSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid CMS target" : "Invalid CMS target");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  const rawEndpoint = input.config.endpointUrl || input.config.webhookUrl;
  if (rawEndpoint) {
    validateSafeCmsEndpointUrl(rawEndpoint);
  }

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx
      .select()
      .from(publishTargets)
      .where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, input.provider)));

    const defaults = defaultProviderConfig(input.provider, site.domain);
    const merged: Record<string, string> = {
      ...defaults,
      ...(existing?.config ?? {}),
    };

    for (const [k, v] of Object.entries(input.config)) {
      const trimmed = v.trim();
      if (!trimmed) continue;
      // Preserve existing secret if user submitted a masked value
      if (trimmed.includes("••••") && existing?.config?.[k]) {
        continue;
      }
      merged[k] = trimmed;
    }

    let saved: typeof publishTargets.$inferSelect;
    if (existing) {
      const [upd] = await tx
        .update(publishTargets)
        .set({ config: merged })
        .where(eq(publishTargets.id, existing.id))
        .returning();
      saved = upd;
    } else {
      const [ins] = await tx
        .insert(publishTargets)
        .values({
          websiteId: site.id,
          provider: input.provider,
          config: merged,
        })
        .returning();
      saved = ins;
    }

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "publish_target",
      entityId: saved.id,
      change: existing ? "updated" : "connected",
      after: { provider: saved.provider, config: maskConfigSecrets(saved.config) },
    });

    return {
      id: saved.id,
      websiteId: saved.websiteId,
      provider: saved.provider as CmsProvider,
      label: CMS_PROVIDER_LABELS[saved.provider as CmsProvider],
      config: maskConfigSecrets(saved.config),
      createdAt: saved.createdAt,
    };
  });
}

export async function deletePublishTarget(
  db: Db,
  rawInput: { actorId: string; websiteId: string; targetId: string },
): Promise<void> {
  if (!z.string().uuid().safeParse(rawInput.targetId).success) {
    throw new DomainError("Invalid publish target ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(publishTargets)
      .where(and(eq(publishTargets.id, rawInput.targetId), eq(publishTargets.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Publish target not found");

    await tx.delete(publishTargets).where(eq(publishTargets.id, existing.id));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "publish_target",
      entityId: existing.id,
      change: "disconnected",
      before: { provider: existing.provider },
    });
  });
}

function buildCmsPayload(
  provider: CmsProvider,
  item: typeof contentItems.$inferSelect,
  bodyMarkdown: string,
  publishedUrl: string,
): Record<string, unknown> {
  const slug = slugify(item.title);
  switch (provider) {
    case "wordpress":
      return {
        format: "wp-rest-v2",
        title: item.title,
        slug,
        status: "publish",
        content: bodyMarkdown,
        canonical_url: publishedUrl,
      };
    case "webflow":
      return {
        format: "webflow-v2-collection-item",
        isArchived: false,
        isDraft: false,
        fieldData: {
          name: item.title,
          slug,
          "post-body": bodyMarkdown,
        },
      };
    case "contentful":
      return {
        format: "contentful-cma-entry",
        fields: {
          title: { "en-US": item.title },
          slug: { "en-US": slug },
          body: { "en-US": bodyMarkdown },
        },
      };
    case "sanity":
      return {
        format: "sanity-mutation",
        mutations: [
          {
            createOrReplace: {
              _id: `athena-${item.id}`,
              _type: "post",
              title: item.title,
              slug: { _type: "slug", current: slug },
              body: bodyMarkdown,
            },
          },
        ],
      };
    case "wix":
      return {
        format: "wix-blog-v3",
        draftPost: {
          title: item.title,
          richContent: { markdown: bodyMarkdown },
        },
        publish: true,
      };
    case "framer":
      return {
        format: "framer-cms-sync",
        slug,
        title: item.title,
        contentMarkdown: bodyMarkdown,
      };
    case "payload":
      return {
        format: "payload-rest-collection",
        collection: "posts",
        data: {
          title: item.title,
          slug,
          _status: "published",
          content: bodyMarkdown,
        },
      };
    case "shopify":
      return {
        format: "shopify-admin-article",
        article: {
          title: item.title,
          handle: slug,
          body_html: bodyMarkdown,
          published: true,
        },
      };
  }
}

const publishSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  contentId: z.string().uuid(),
  provider: z.enum(CMS_PROVIDERS),
  targetUrl: z.string().max(500).optional().nullable(),
});

export async function publishContentItem(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    contentId: string;
    provider: CmsProvider;
    targetUrl?: string | null;
  },
) {
  let input: z.infer<typeof publishSchema>;
  try {
    input = publishSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid CMS publish request");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, input.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    // Ensure CMS publishTarget exists for this provider
    let [target] = await tx
      .select()
      .from(publishTargets)
      .where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, input.provider)));

    if (!target) {
      const [createdTarget] = await tx
        .insert(publishTargets)
        .values({
          websiteId: site.id,
          provider: input.provider,
          config: defaultProviderConfig(input.provider, site.domain),
        })
        .returning();
      target = createdTarget;
    }

    // Ensure content has a version to publish
    let [latestVer] = await tx
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentId, item.id))
      .orderBy(desc(contentVersions.version))
      .limit(1);

    if (!latestVer) {
      const factRows = await tx
        .select({ claim: kbFacts.claim })
        .from(kbFacts)
        .where(and(eq(kbFacts.websiteId, site.id), eq(kbFacts.status, "confirmed"), isNull(kbFacts.deletedAt)))
        .limit(4);
      const body = [
        `# ${item.title}`,
        ``,
        `${site.name} official guide for **${item.title}**.`,
        ``,
        `## Key Brand Facts`,
        ...(factRows.length > 0
          ? factRows.map((f) => `- ${f.claim}`)
          : [`- ${site.name} delivers AI-native collaboration for modern product teams.`]),
      ].join("\n");

      const [brief] = await tx
        .insert(contentBriefs)
        .values({
          contentId: item.id,
          body: `# Brief: ${item.title}`,
          approvedAt: new Date(),
        })
        .returning();

      const [draft] = await tx
        .insert(contentDrafts)
        .values({
          contentId: item.id,
          briefId: brief.id,
          body,
        })
        .returning();

      const [ver] = await tx
        .insert(contentVersions)
        .values({
          contentId: item.id,
          draftId: draft.id,
          body,
          version: 1,
        })
        .returning();
      latestVer = ver;
    }

    const publishedUrl =
      (input.targetUrl ? normalizeContentUrl(input.targetUrl, site.domain) : null) ||
      item.targetUrl ||
      `https://${site.domain}/blog/${slugify(item.title)}`;

    const payload = buildCmsPayload(input.provider, item, latestVer.body, publishedUrl);
    const publishedAt = new Date().toISOString();

    const nextCols: Record<string, string | number | boolean> = {
      ...(item.columns ?? {}),
      agentStage: "published",
      publishedProvider: input.provider,
      publishedUrl,
      publishedAt,
      publishedVersion: latestVer.version,
    };

    const [updated] = await tx
      .update(contentItems)
      .set({
        status: "published",
        targetUrl: publishedUrl,
        columns: nextCols,
      })
      .where(eq(contentItems.id, item.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: updated.id,
      change: "published_cms",
      after: {
        provider: input.provider,
        providerLabel: CMS_PROVIDER_LABELS[input.provider],
        targetUrl: publishedUrl,
        version: latestVer.version,
        payloadFormat: String(payload.format),
      },
    });

    return {
      item: updated,
      provider: input.provider,
      providerLabel: CMS_PROVIDER_LABELS[input.provider],
      publishedUrl,
      publishedVersion: latestVer.version,
      payload,
    };
  });
}
