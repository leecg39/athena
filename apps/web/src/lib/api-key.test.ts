import { describe, expect, it } from "vitest";
import { rateLimit, rateLimitBucketCount } from "./api-key";

describe("rateLimit", () => {
  it("allows 60 requests per minute per key then refills", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) expect(rateLimit("k1", t0).ok).toBe(true);
    expect(rateLimit("k1", t0).ok).toBe(false);
    expect(rateLimit("k1", t0 + 2_000).ok).toBe(true); // 1 token/sec refill
  });
  it("keeps memory bounded under many distinct keys", () => {
    for (let i = 0; i < 12_000; i++) rateLimit(`flood-${i}`, 5_000_000);
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(10_000);
  });
});
