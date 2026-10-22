import "server-only";

/** Key material for sealing integration credentials. */
export function integrationKey(): string {
  const key = process.env.INTEGRATIONS_SECRET ?? process.env.AUTH_SECRET;
  if (!key) throw new Error("INTEGRATIONS_SECRET (or AUTH_SECRET) must be set to store integration credentials");
  return key;
}

export function gscConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
