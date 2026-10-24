/**
 * Slack incoming webhook per website. Only https://hooks.slack.com/services/…
 * URLs are accepted (the URL is the secret, so it is sealed and never returned).
 */
import { and, eq } from "drizzle-orm";
import { type Db, integrations } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError } from "../org/errors";
import { decryptSecret, encryptSecret } from "../integrations/crypto";
import { normalizeSlackChannel } from "./catalog";

const HOOK_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;

export function validSlackWebhook(url: string): string {
  const u = url.trim();
  if (u.length > 300 || !HOOK_RE.test(u)) throw new DomainError("Use a Slack incoming webhook URL (https://hooks.slack.com/services/…)");
  return u;
}

const slackRow = (siteId: string) => and(eq(integrations.websiteId, siteId), eq(integrations.provider, "slack"));

export async function connectSlackWebhook(db: Db, input: { actorId: string; websiteId: string; webhookUrl: string; channel?: string | null; secretKey: string }): Promise<void> {
  const url = validSlackWebhook(input.webhookUrl);
  const channel = normalizeSlackChannel(input.channel);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "websites:write");
  const secret = encryptSecret(JSON.stringify({ webhookUrl: url }), input.secretKey);
  const values = { status: "connected", externalAccount: channel ?? "Slack", config: { channel: channel ?? "" }, secret, connectedBy: input.actorId };
  await db.transaction(async (tx) => {
    await tx.insert(integrations).values({ websiteId: site.id, provider: "slack", ...values }).onConflictDoUpdate({ target: [integrations.websiteId, integrations.provider], set: { ...values, updatedAt: new Date() } });
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "integration", change: "connected", after: { provider: "slack", channel } });
  });
}

export async function disconnectSlack(db: Db, input: { actorId: string; websiteId: string }): Promise<void> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "websites:write");
  await db.transaction(async (tx) => {
    await tx.delete(integrations).where(slackRow(site.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "integration", change: "disconnected", before: { provider: "slack" } });
  });
}

export async function getSlackConnection(db: Db, input: { actorId: string; websiteId: string }): Promise<{ connected: boolean; channel: string | null; connectedAt: Date | null }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const [row] = await db.select({ status: integrations.status, config: integrations.config, connectedAt: integrations.connectedAt }).from(integrations).where(slackRow(site.id));
  return { connected: row?.status === "connected", channel: row?.config?.channel || null, connectedAt: row?.connectedAt ?? null };
}

/** The webhook URL for a website (already authorised callers only). */
export async function slackWebhookForSite(db: Db, websiteId: string, secretKey: string): Promise<string | null> {
  const [row] = await db.select({ status: integrations.status, secret: integrations.secret }).from(integrations).where(slackRow(websiteId));
  if (row?.status !== "connected" || !row.secret) return null;
  try {
    const parsed = JSON.parse(decryptSecret(row.secret, secretKey)) as { webhookUrl?: unknown };
    return typeof parsed.webhookUrl === "string" && HOOK_RE.test(parsed.webhookUrl) ? parsed.webhookUrl : null;
  } catch {
    return null;
  }
}
