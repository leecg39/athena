/**
 * Small in-memory sliding-window limiters for expensive user actions
 * (per server instance; a shared store is needed for multi-instance limits).
 */
export function createLimiter(max: number, windowMs: number, maxKeys = 10_000) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): { ok: boolean; retryAfterMs: number } => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return { ok: false, retryAfterMs: windowMs - (now - recent[0]) };
    }
    if (!hits.has(key) && hits.size >= maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    hits.set(key, [...recent, now]);
    return { ok: true, retryAfterMs: 0 };
  };
}

/** Website analysis (crawl) during onboarding: 10 per user per 10 minutes. */
export const crawlLimiter = createLimiter(10, 10 * 60_000);

/** Prompt discovery (Search Console + LLM calls): 20 runs per user per 10 minutes. */
export const discoveryLimiter = createLimiter(20, 10 * 60_000);

/** Competitor changes (each re-analyses every stored answer): 30 per user per 10 minutes. */
export const competitorLimiter = createLimiter(30, 10 * 60_000);

/** Ask Athena answers (each runs an AI model with tools): 20 per user per 10 minutes. */
export const askLimiter = createLimiter(20, 10 * 60_000);

/** New Ask Athena chats: 30 per user per 10 minutes. */
export const threadLimiter = createLimiter(30, 10 * 60_000);

/** On-demand AI insights generation: 20 per user per 10 minutes. */
export const insightsLimiter = createLimiter(20, 10 * 60_000);
