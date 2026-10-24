/**
 * CMS connections. Every supported CMS publishes directly through its own API
 * (see cms-providers). Secret fields are sealed with the integrations key and
 * never returned in clear.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { type Db, publishTargets, websites } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { decryptSecret, encryptSecret } from "../integrations/crypto";
import { CMS_PROVIDER_LABELS, CMS_PROVIDERS, type CmsProvider } from "./shared";
import { PROVIDERS, type FieldSpec } from "./cms-providers";

export const CMS_FIELDS = Object.fromEntries(CMS_PROVIDERS.map((p) => [p, PROVIDERS[p].fields])) as Record<CmsProvider, FieldSpec[]>;

/** What the connection form needs to render each CMS (no validators, no stored values). */
export function cmsConnectionSchema() {
  return CMS_PROVIDERS.map((p) => ({
    provider: p,
    label: CMS_PROVIDER_LABELS[p],
    note: PROVIDERS[p].note,
    fields: PROVIDERS[p].fields.map((f) => ({ key: f.key, label: f.label, secret: Boolean(f.secret), required: f.required, placeholder: f.placeholder ?? f.defaultValue ?? "", options: f.options ? [...f.options] : null })),
  }));
}
export type CmsConnectionSchema = ReturnType<typeof cmsConnectionSchema>;

const SEALED = "enc:";
const MASK = "••••••••";

export interface PublishTargetView {
  id: string;
  websiteId: string;
  provider: CmsProvider;
  label: string;
  configured: boolean;
  config: Record<string, string>;
  createdAt: Date;
}

/** Every required field of the connection has a value. */
export function targetConfigured(provider: string, config: Record<string, string> | null | undefined): boolean {
  const fields = CMS_FIELDS[provider as CmsProvider] ?? [];
  return fields.length > 0 && fields.every((f) => !f.required || Boolean(config?.[f.key]));
}

function view(row: typeof publishTargets.$inferSelect): PublishTargetView {
  const provider = row.provider as CmsProvider;
  const fields = CMS_FIELDS[provider] ?? [];
  // only known fields are shown; secrets (and anything sealed) are masked, unknown legacy keys are dropped
  const config = Object.fromEntries(fields.flatMap((f) => { const v = row.config?.[f.key]; return v ? [[f.key, f.secret || v.startsWith(SEALED) ? MASK : v]] : []; }));
  return {
    id: row.id,
    websiteId: row.websiteId,
    provider,
    label: CMS_PROVIDER_LABELS[provider] ?? provider,
    configured: targetConfigured(provider, row.config),
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

const seal = (f: FieldSpec, value: string, secretKey: string) => (f.secret && !value.startsWith(SEALED) ? `${SEALED}${encryptSecret(value, secretKey)}` : value);

/** Validated, sealed field values merged over the existing ones (masked or empty input keeps a value, else the default). */
function mergeConfig(provider: CmsProvider, existing: Record<string, string>, incoming: Record<string, string>, secretKey: string, site: { domain: string }): Record<string, string> {
  return CMS_FIELDS[provider].reduce<Record<string, string>>((acc, f) => {
    const raw = incoming[f.key]?.trim();
    if (!raw || raw.includes("••••")) {
      const kept = existing[f.key] || f.defaultValue;
      return kept ? { ...acc, [f.key]: seal(f, kept, secretKey) } : acc;
    }
    let value: string;
    try {
      value = f.parse(raw, site);
    } catch (err) {
      throw err instanceof DomainError ? err : new DomainError(`${f.label} is not valid`);
    }
    return { ...acc, [f.key]: seal(f, value, secretKey) };
  }, {});
}

export async function upsertPublishTarget(
  db: Db,
  input: { actorId: string; websiteId: string; provider: CmsProvider; config?: Record<string, string>; secretKey: string },
): Promise<PublishTargetView> {
  if (!(CMS_PROVIDERS as readonly string[]).includes(input.provider)) throw new DomainError("Unknown CMS");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const provider = input.provider;
  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx.select().from(publishTargets).where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, provider)));
    const config = mergeConfig(provider, existing?.config ?? {}, input.config ?? {}, input.secretKey, site);
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
