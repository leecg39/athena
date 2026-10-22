/** AES-256-GCM secret sealing and HMAC-signed OAuth state. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

function keyFrom(material: string): Buffer {
  if (!material) throw new Error("Encryption key material is not configured");
  return createHash("sha256").update(material).digest();
}

/** → "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyMaterial), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(token: string, keyMaterial: string): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== VERSION || !iv || !tag || ct === undefined) throw new Error("Malformed secret");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyMaterial), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export interface StatePayload {
  websiteId: string;
  userId: string;
  nonce?: string;
  exp?: number;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** Signed, expiring state for OAuth round-trips (binds website + user). */
export function signState(payload: Omit<StatePayload, "exp" | "nonce">, secret: string, now = Date.now(), ttlSeconds = 600): string {
  const body = b64(JSON.stringify({ ...payload, nonce: randomBytes(8).toString("hex"), exp: now + ttlSeconds * 1000 }));
  const sig = createHmac("sha256", keyFrom(secret)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(token: string, secret: string, now = Date.now()): StatePayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", keyFrom(secret)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    if (typeof data.websiteId !== "string" || typeof data.userId !== "string" || typeof data.exp !== "number") return null;
    return data.exp > now ? data : null;
  } catch {
    return null;
  }
}
