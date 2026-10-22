/** Google Search Console: OAuth (read-only), property discovery, encrypted credential storage. */
import { and, eq } from "drizzle-orm";
import { type Db, integrations } from "@athena/db";
import { requireWebsitePermission } from "../tenancy/index";
import { logActivity } from "../org/activity";
import { DomainError } from "../org/errors";
import { decryptSecret, encryptSecret } from "./crypto";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export function gscAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeGscCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleTokens> {
  const res = await (opts.fetchImpl ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new DomainError(`Google token exchange failed (${res.status})`);
  const data = (await res.json()) as GoogleTokens;
  if (!data.access_token) throw new DomainError("Google did not return an access token");
  return data;
}

export async function refreshGoogleAccessToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const res = await (opts.fetchImpl ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: "refresh_token",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new DomainError(`Google token refresh failed (${res.status})`);
  const data = (await res.json()) as GoogleTokens;
  return data.access_token;
}

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export async function listGscSites(accessToken: string, fetchImpl: FetchLike = fetch): Promise<GscSite[]> {
  const res = await fetchImpl("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new DomainError(`Search Console sites request failed (${res.status})`);
  const data = (await res.json()) as { siteEntry?: GscSite[] };
  return data.siteEntry ?? [];
}

const USABLE = new Set(["siteOwner", "siteFullUser", "siteRestrictedUser"]);

/** Best verified property for a domain: domain property first, then URL-prefix variants. */
export function matchGscProperty(sites: GscSite[], domain: string): string | null {
  const usable = sites.filter((s) => USABLE.has(s.permissionLevel));
  const candidates = [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`];
  for (const c of candidates) {
    const hit = usable.find((s) => s.siteUrl.toLowerCase() === c);
    if (hit) return hit.siteUrl;
  }
  return null;
}

export interface IntegrationStatus {
  provider: string;
  status: string;
  externalAccount: string | null;
  connectedAt: Date;
  updatedAt: Date;
}

export async function getIntegration(db: Db, websiteId: string, provider: string): Promise<IntegrationStatus | null> {
  const [row] = await db
    .select({
      provider: integrations.provider,
      status: integrations.status,
      externalAccount: integrations.externalAccount,
      connectedAt: integrations.connectedAt,
      updatedAt: integrations.updatedAt,
    })
    .from(integrations)
    .where(and(eq(integrations.websiteId, websiteId), eq(integrations.provider, provider)));
  return row ?? null;
}

export async function saveGscConnection(
  db: Db,
  input: { actorId: string; websiteId: string; refreshToken: string; property: string; key: string },
): Promise<void> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "websites:write");
  const secret = encryptSecret(JSON.stringify({ refreshToken: input.refreshToken }), input.key);
  await db.transaction(async (tx) => {
    await tx
      .insert(integrations)
      .values({ websiteId: site.id, provider: "gsc", status: "connected", externalAccount: input.property, config: { property: input.property }, secret, connectedBy: input.actorId })
      .onConflictDoUpdate({
        target: [integrations.websiteId, integrations.provider],
        set: { status: "connected", externalAccount: input.property, config: { property: input.property }, secret, connectedBy: input.actorId, updatedAt: new Date() },
      });
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "integration",
      change: "connected",
      after: { provider: "gsc", property: input.property },
    });
  });
}

export async function disconnectIntegration(db: Db, input: { actorId: string; websiteId: string; provider: string }): Promise<void> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "websites:write");
  await db.transaction(async (tx) => {
    await tx
      .update(integrations)
      .set({ status: "disconnected", secret: null, updatedAt: new Date() })
      .where(and(eq(integrations.websiteId, site.id), eq(integrations.provider, input.provider)));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "integration",
      change: "disconnected",
      after: { provider: input.provider },
    });
  });
}

/** Decrypt stored GSC credentials (server-side use only). */
export function readGscCredentials(row: { secret: string | null; config: Record<string, string> }, key: string): { refreshToken: string; property: string } {
  if (!row.secret) throw new DomainError("Search Console is not connected");
  const { refreshToken } = JSON.parse(decryptSecret(row.secret, key)) as { refreshToken: string };
  return { refreshToken, property: row.config.property ?? "" };
}

export interface GscQueryRow {
  query: string;
  impressions: number;
  clicks: number;
}

/** Top search queries for a property over the last `days` days (ending yesterday, UTC). */
export async function fetchGscTopQueries(opts: {
  accessToken: string;
  property: string;
  days?: number;
  rowLimit?: number;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<GscQueryRow[]> {
  const days = opts.days ?? 28;
  const end = new Date((opts.now ?? new Date()).getTime() - 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const res = await (opts.fetchImpl ?? fetch)(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(opts.property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ["query"],
        rowLimit: opts.rowLimit ?? 250,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new DomainError(`Search Console query failed (${res.status})`);
  const data = (await res.json()) as { rows?: { keys?: string[]; impressions?: number; clicks?: number }[] };
  return (data.rows ?? [])
    .filter((r) => r.keys?.[0])
    .map((r) => ({ query: r.keys![0], impressions: Math.round(r.impressions ?? 0), clicks: Math.round(r.clicks ?? 0) }));
}
