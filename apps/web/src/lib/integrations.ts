import "server-only";
import { and, eq } from "drizzle-orm";
import { db, integrations } from "@athena/db";
import { readGscCredentials, refreshGoogleAccessToken } from "@athena/core/integrations";

/** Key material for sealing integration credentials. */
export function integrationKey(): string {
  const key = process.env.INTEGRATIONS_SECRET ?? process.env.AUTH_SECRET;
  if (!key) throw new Error("INTEGRATIONS_SECRET (or AUTH_SECRET) must be set to store integration credentials");
  return key;
}

export function gscConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** A fresh Search Console access token for a website, or null when not connected. Throws on credential/network failure. */
export async function gscAccess(websiteId: string): Promise<{ accessToken: string; property: string } | null> {
  if (!gscConfigured()) return null;
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.websiteId, websiteId), eq(integrations.provider, "gsc"), eq(integrations.status, "connected")));
  if (!row) return null;
  const creds = readGscCredentials(row, integrationKey());
  const accessToken = await refreshGoogleAccessToken({
    refreshToken: creds.refreshToken,
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  });
  return { accessToken, property: creds.property };
}

/** Whether Search Console is connected for a website (no network call). */
export async function gscConnected(websiteId: string): Promise<boolean> {
  if (!gscConfigured()) return false;
  const [row] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.websiteId, websiteId), eq(integrations.provider, "gsc"), eq(integrations.status, "connected")));
  return Boolean(row);
}
