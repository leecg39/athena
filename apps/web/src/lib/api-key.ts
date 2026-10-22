import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { API_KEY_PREFIX, hashApiKey, verifyApiKey } from "@athena/core/org";

/* ------------------------------------------------------------------ */
/* Rate limiting (in-memory token bucket, per key)                     */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, { tokens: number; last: number }>();
const RATE = 60; // requests per minute
const REFILL_PER_SEC = RATE / 60;
const MAX_BUCKETS = 10_000;

/** Bound memory: drop idle buckets (full again after 60s), then the oldest. */
function pruneBuckets(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) if (now - b.last > 60_000) buckets.delete(k);
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

/** In-memory token bucket per key hash (per server instance). */
export function rateLimit(key: string, now = Date.now()): { ok: boolean; remaining: number } {
  const existing = buckets.get(key);
  if (!existing) pruneBuckets(now);
  const b = existing ?? { tokens: RATE, last: now };
  const elapsed = (now - b.last) / 1000;
  const tokens = Math.min(RATE, b.tokens + elapsed * REFILL_PER_SEC);
  if (tokens < 1) {
    buckets.set(key, { tokens, last: now });
    return { ok: false, remaining: 0 };
  }
  buckets.set(key, { tokens: tokens - 1, last: now });
  return { ok: true, remaining: Math.floor(tokens - 1) };
}

export function rateLimitBucketCount(): number {
  return buckets.size;
}

export function resetRateLimitBuckets(): void {
  buckets.clear();
}

export interface ApiContext {
  organizationId: string;
  keyId: string;
  rateLimitRemaining?: number;
}

/**
 * Authenticate a /api/v1 request via `Authorization: Bearer ath_…` or `X-API-Key: ath_…`.
 * Returns a 401/429 response on failure, or the API context. Database errors
 * propagate (500) — there is no fallback key.
 */
export async function authenticate(req: NextRequest): Promise<ApiContext | NextResponse> {
  const authz = req.headers.get("authorization") ?? "";
  const xApiKey = req.headers.get("x-api-key") ?? "";
  const token = (authz ? authz.replace(/^Bearer\s+/i, "") : xApiKey).trim();
  if (!token.startsWith(API_KEY_PREFIX)) {
    return NextResponse.json({ error: "missing or malformed api key" }, { status: 401 });
  }
  const limit = rateLimit(hashApiKey(token));
  if (!limit.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": "5",
          "X-RateLimit-Limit": String(RATE),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }
  const ctx = await verifyApiKey(db, token);
  if (!ctx) return NextResponse.json({ error: "invalid api key" }, { status: 401 });
  return { ...ctx, rateLimitRemaining: limit.remaining };
}

export function isResponse(ctx: ApiContext | NextResponse): ctx is NextResponse {
  return ctx instanceof NextResponse;
}
