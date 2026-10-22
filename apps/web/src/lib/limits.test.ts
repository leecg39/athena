import { describe, expect, it } from "vitest";
import { createLimiter } from "./limits";

describe("createLimiter", () => {
  it("allows max hits per window per key, then recovers", () => {
    const limit = createLimiter(2, 1000);
    expect(limit("u", 0).ok).toBe(true);
    expect(limit("u", 10).ok).toBe(true);
    expect(limit("u", 20)).toEqual({ ok: false, retryAfterMs: 980 });
    expect(limit("other", 20).ok).toBe(true);
    expect(limit("u", 1001).ok).toBe(true);
  });
});
