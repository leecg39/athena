/**
 * CMS connections. Direct publishing is implemented for WordPress (REST API +
 * Application Password) and Shopify (Admin REST articles); other CMSs are
 * export-only until a real integration exists. Secret fields are sealed with
 * the integrations key and never returned in clear.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { type Db, publishTargets, websites } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { decryptSecret, encryptSecret } from "../integrations/crypto";
import { CMS_PROVIDER_LABELS, CMS_PROVIDERS, type CmsProvider, validateSafeCmsEndpointUrl } from "./shared";

export const DIRECT_PROVIDERS = ["wordpress", "shopify"] as const satisfies readonly CmsProvider[];
export type DirectProvider = (typeof DIRECT_PROVIDERS)[number];
export const isDirect = (p: string): p is DirectProvider => (DIRECT_PROVIDERS as readonly string[]).includes(p);

interface FieldSpec {
  key: string;
  label: string;
  secret?: boolean;
  required: boolean;
  parse: (v: string) => string;
}

const text = (max: number) => (v: string) => z.string().trim().min(1).max(max).parse(v);
const httpsUrl = (v: string) => {
  const url = validateSafeCmsEndpointUrl(v);
  if (!url || !url.startsWith("https://")) throw new DomainError("Use an https:// site URL so credentials stay encrypted in transit");
  return url.replace(/\/+$/, "");
};

export const CMS_FIELDS: Record<DirectProvider, FieldSpec[]> = {
  wordpress: [
    { key: "siteUrl", label: "Site URL", required: true, parse: httpsUrl },
    { key: "username", label: "Username", required: true, parse: text(100) },
    { key: "applicationPassword", label: "Application password", secret: true, required: true, parse: text(200) },
  ],
  shopify: [
    { key: "storeDomain", label: "Store domain (*.myshopify.com)", required: true, parse: (v) => { if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(v.trim())) throw new DomainError("Use the store's *.myshopify.com domain"); return v.trim().toLowerCase(); } },
    { key: "blogId", label: "Blog ID", required: true, parse: (v) => { if (!/^\d{1,20}$/.test(v.trim())) throw new DomainError("The blog ID is the number in the blog's admin URL"); return v.trim(); } },
    { key: "accessToken", label: "Admin API access token", secret: true, required: true, parse: text(200) },
    { key: "blogHandle", label: "Blog handle (for public links)", required: false, parse: (v) => { if (!/^[a-z0-9-]{1,100}$/.test(v.trim())) throw new DomainError("The blog handle uses lowercase letters, numbers and dashes"); return v.trim(); } },
  ],
};

const SEALED = "enc:";
const MASK = "••••••••";

export interface PublishTargetView {
  id: string;
  websiteId: string;
  provider: CmsProvider;
  label: string;
  mode: "direct" | "export";
  configured: boolean;
  config: Record<string, string>;
  createdAt: Date;
}

function view(row: typeof publishTargets.$inferSelect): PublishTargetView {
  const provider = row.provider as CmsProvider;
  const fields = isDirect(provider) ? CMS_FIELDS[provider] : [];
  // only known fields are shown; secrets (and anything sealed) are masked, unknown legacy keys are dropped
  const config = Object.fromEntries(fields.flatMap((f) => { const v = row.config?.[f.key]; return v ? [[f.key, f.secret || v.startsWith(SEALED) ? MASK : v]] : []; }));
  return {
    id: row.id,
    websiteId: row.websiteId,
    provider,
    label: CMS_PROVIDER_LABELS[provider] ?? provider,
    mode: isDirect(provider) ? "direct" : "export",
    configured: fields.length > 0 && fields.every((f) => !f.required || Boolean(row.config?.[f.key])),
    config,
    createdAt: row.createdAt,
  };
}

/** Field values for an outgoing request (secrets unsealed). */
export function openTargetConfig(row: typeof publishTargets.$inferSelect, secretKey: string): Record<string, string> {
  return Object.fromEntries(Object.entries(row.config ?? {}).map(([k, v]) => [k, v.startsWith(SEALED) ? decryptSecret(v.slice(SEALED.length), secretKey) : v]));
}

export async function listPublishTargets(db: Db, input: { actorId: string; websiteId: string }): Promise<PublishTargetView[]> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const rows = await db.select().from(publishTargets).where(eq(publishTargets.websiteId, site.id)).orderBy(publishTargets.provider);
  return rows.map(view);
}

/** Validated, sealed field values merged over the existing ones (masked or empty input keeps a value). */
function mergeConfig(provider: DirectProvider, existing: Record<string, string>, incoming: Record<string, string>, secretKey: string): Record<string, string> {
  return CMS_FIELDS[provider].reduce<Record<string, string>>((acc, f) => {
    const raw = incoming[f.key]?.trim();
    if (!raw || raw.includes("••••")) return existing[f.key] ? { ...acc, [f.key]: existing[f.key] } : acc;
    let value: string;
    try {
      value = f.parse(raw);
    } catch (err) {
      throw err instanceof DomainError ? err : new DomainError(`${f.label} is not valid`);
    }
    return { ...acc, [f.key]: f.secret ? `${SEALED}${encryptSecret(value, secretKey)}` : value };
  }, {});
}

export async function upsertPublishTarget(
  db: Db,
  input: { actorId: string; websiteId: string; provider: CmsProvider; config?: Record<string, string>; secretKey: string },
): Promise<PublishTargetView> {
  if (!(CMS_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainError("Unknown CMS");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  if (!isDirect(input.provider)) throw new DomainError(`Direct publishing to ${CMS_PROVIDER_LABELS[input.provider]} isn't available yet — use Export from the Content Hub instead`);
  const provider = input.provider;
  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx.select().from(publishTargets).where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, provider)));
    const config = mergeConfig(provider, existing?.config ?? {}, input.config ?? {}, input.secretKey);
    const [saved] = existing
      ? await tx.update(publishTargets).set({ config }).where(eq(publishTargets.id, existing.id)).returning()
      : await tx.insert(publishTargets).values({ websiteId: site.id, provider, config }).returning();
    const result = view(saved);
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "publish_target", entityId: saved.id, change: existing ? "updated" : "connected", after: { provider, config: result.config } });
    return result;
  });
}

export async function deletePublishTarget(db: Db, input: { actorId: string; websiteId: string; targetId: string }): Promise<void> {
  if (!z.string().uuid().safeParse(input.targetId).success) throw new DomainError("Invalid publish target ID");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(publishTargets).where(and(eq(publishTargets.id, input.targetId), eq(publishTargets.websiteId, site.id)));
    if (!row) throw new NotFoundError("Publish target not found");
    await tx.delete(publishTargets).where(eq(publishTargets.id, row.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "publish_target", entityId: row.id, change: "disconnected", before: { provider: row.provider } });
  });
}
