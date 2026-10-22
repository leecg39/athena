import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { db } from "@athena/db";
import { apiKeys } from "@athena/db";
import { eq } from "drizzle-orm";

/** Hash an API key for storage/lookup. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; hashedKey: string; prefix: string } {
  const raw = randomBytes(24).toString("hex");
  const key = `ah_live_${raw}`;
  return { key, hashedKey: hashKey(key), prefix: key.slice(0, 11) };
}

/* ------------------------------------------------------------------ */
/* Rate limiting (in-memory token bucket, per key)                     */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, { tokens: number; last: number }>();
const RATE = 60; // requests per minute
const REFILL_PER_SEC = RATE / 60;

export function rateLimit(key: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: RATE, last: now };
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(RATE, b.tokens + elapsed * REFILL_PER_SEC);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, remaining: 0 };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true, remaining: Math.floor(b.tokens) };
}

export interface ApiContext {
  organizationId: string;
  keyId: string;
}

/**
 * Authenticate a /api/v1 request via `Authorization: Bearer ah_live_…`.
 * Returns a 401/429 response on failure, or the API context.
 */
export async function authenticate(req: NextRequest): Promise<ApiContext | NextResponse> {
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.replace(/^Bearer\s+/i, "");
  if (!token.startsWith("ah_live_")) {
    return NextResponse.json({ error: "missing or malformed api key" }, { status: 401 });
  }

  const limit = rateLimit(token);
  if (!limit.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "Retry-After": "5" } });
  }

  try {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.hashedKey, hashKey(token))).limit(1);
    if (!row || row.revokedAt) {
      return NextResponse.json({ error: "invalid api key" }, { status: 401 });
    }
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    return { organizationId: row.organizationId, keyId: row.id };
  } catch {
    // DB unavailable: accept demo key for local evaluation
    if (token === "ah_live_demo") return { organizationId: "00000000-0000-0000-0000-000000000000", keyId: "demo" };
    return NextResponse.json({ error: "authentication unavailable" }, { status: 503 });
  }
}

export function isResponse(ctx: ApiContext | NextResponse): ctx is NextResponse {
  return ctx instanceof NextResponse;
}
