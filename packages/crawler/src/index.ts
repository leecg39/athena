/**
 * Site crawler: brand profile suggestion, AI-crawler access checks against
 * robots.txt, and sitemap discovery. All network access goes through the
 * SSRF-safe fetcher in ./net.
 */
import { safeFetch, BlockedUrlError, type SafeResponse } from "./net";
import { parseRobots, evaluateRobots, type ParsedRobots } from "./robots";
import { extractBrand, domainOf, type BrandSuggestion } from "./brand";

export { safeFetch, createSafeFetcher, isPublicAddress, BlockedUrlError, CRAWLER_UA } from "./net";
export { parseRobots, evaluateRobots } from "./robots";
export { extractBrand, domainOf, type BrandSuggestion } from "./brand";

/** AI crawlers / user agents that decide whether AI search can read a site. */
export const AI_BOTS = [
  { token: "OAI-SearchBot", owner: "OpenAI", purpose: "ChatGPT search index" },
  { token: "ChatGPT-User", owner: "OpenAI", purpose: "ChatGPT live browsing" },
  { token: "GPTBot", owner: "OpenAI", purpose: "Model training" },
  { token: "Claude-SearchBot", owner: "Anthropic", purpose: "Claude search index" },
  { token: "Claude-User", owner: "Anthropic", purpose: "Claude live browsing" },
  { token: "ClaudeBot", owner: "Anthropic", purpose: "Model training" },
  { token: "PerplexityBot", owner: "Perplexity", purpose: "Perplexity search index" },
  { token: "Perplexity-User", owner: "Perplexity", purpose: "Perplexity live browsing" },
  { token: "Google-Extended", owner: "Google", purpose: "Gemini grounding / training" },
  { token: "Applebot-Extended", owner: "Apple", purpose: "Apple Intelligence training" },
  { token: "meta-externalagent", owner: "Meta", purpose: "Meta AI" },
  { token: "Bytespider", owner: "ByteDance", purpose: "Model training" },
  { token: "CCBot", owner: "Common Crawl", purpose: "Open web corpus" },
] as const;

export type AiAccessStatus = "allowed" | "blocked" | "unknown";

export interface AiAccessReport {
  bot: string;
  owner: string;
  purpose: string;
  status: AiAccessStatus;
  detail: string;
}

export interface CrawlResult {
  url: string;
  suggestion: BrandSuggestion;
  aiAccess: AiAccessReport[];
  sitemapUrls: string[];
  robotsStatus: "found" | "missing" | "error";
}

/** "example.com" / "https://example.com/x" → "https://example.com/" origin URL. */
export function homepageUrl(input: string): string {
  const trimmed = input.trim();
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  return `${url.protocol}//${url.host}/`;
}

async function tryFetch(url: string, opts?: Parameters<typeof safeFetch>[1]): Promise<SafeResponse | null> {
  try {
    return await safeFetch(url, opts);
  } catch (err) {
    if (err instanceof BlockedUrlError) throw err; // policy violations surface to the caller
    return null;
  }
}

export async function fetchRobots(origin: string): Promise<{ status: CrawlResult["robotsStatus"]; parsed: ParsedRobots | null }> {
  const res = await tryFetch(new URL("/robots.txt", origin).toString(), { maxBytes: 500_000, accept: "text/plain,*/*;q=0.5" });
  if (!res || res.status >= 500) return { status: "error", parsed: null };
  if (res.status >= 400) return { status: "missing", parsed: null }; // RFC 9309: 4xx → no restrictions
  return { status: "found", parsed: parseRobots(res.body) };
}

export function aiAccessFrom(robots: { status: CrawlResult["robotsStatus"]; parsed: ParsedRobots | null }): AiAccessReport[] {
  return AI_BOTS.map((b) => {
    if (robots.status === "error") {
      return { bot: b.token, owner: b.owner, purpose: b.purpose, status: "unknown", detail: "robots.txt could not be fetched" };
    }
    if (!robots.parsed) {
      return { bot: b.token, owner: b.owner, purpose: b.purpose, status: "allowed", detail: "no robots.txt" };
    }
    const v = evaluateRobots(robots.parsed, b.token, "/");
    return {
      bot: b.token,
      owner: b.owner,
      purpose: b.purpose,
      status: v.allowed ? "allowed" : "blocked",
      detail: v.rule ? `${v.rule.allow ? "Allow" : "Disallow"}: ${v.rule.pattern} (group ${v.matchedGroup})` : `no matching rule${v.matchedGroup ? ` (group ${v.matchedGroup})` : ""}`,
    };
  });
}

export async function fetchSitemap(origin: string, hints: string[] = [], limit = 200, maxRequests = 4): Promise<string[]> {
  const candidates = hints.length ? hints : [new URL("/sitemap.xml", origin).toString()];
  const urls: string[] = [];
  const seenIndexes = new Set<string>();
  const queue = candidates.slice(0, 3);
  while (queue.length && urls.length < limit && seenIndexes.size < maxRequests) {
    const next = queue.shift()!;
    if (seenIndexes.has(next)) continue;
    seenIndexes.add(next);
    let res: SafeResponse | null = null;
    try {
      res = await tryFetch(next, { maxBytes: 2_000_000, accept: "application/xml,text/xml,*/*;q=0.5" });
    } catch {
      res = null; // a blocked sitemap hint is skipped, not fatal
    }
    if (!res || res.status >= 400) continue;
    const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (/<sitemapindex/i.test(res.body)) queue.push(...locs.slice(0, 3));
    else urls.push(...locs);
  }
  return [...new Set(urls)].slice(0, limit);
}

/** Crawl a site's homepage, robots.txt and sitemap. Throws BlockedUrlError for disallowed targets. */
export async function crawlSite(site: string): Promise<CrawlResult> {
  const start = homepageUrl(site);
  const home = await tryFetch(start);
  const finalUrl = home?.url ?? start;
  const origin = new URL(finalUrl).origin;
  const suggestion =
    home && home.status < 400 && /html/i.test(home.contentType || "text/html")
      ? extractBrand(home.body, finalUrl)
      : extractBrand("", finalUrl);
  const robots = await fetchRobots(origin);
  const sitemapUrls = await fetchSitemap(origin, robots.parsed?.sitemaps ?? []);
  return { url: finalUrl, suggestion: { ...suggestion, domain: domainOf(finalUrl) }, aiAccess: aiAccessFrom(robots), sitemapUrls, robotsStatus: robots.status };
}

/** Kept for callers that only need the AI access report. */
export async function checkAiAccess(site: string): Promise<AiAccessReport[]> {
  return aiAccessFrom(await fetchRobots(new URL(homepageUrl(site)).origin));
}
