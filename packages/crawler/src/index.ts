/**
 * Site crawler: brand profile suggestion (title/meta/h1 extraction),
 * sitemap discovery, AI-crawler accessibility checks against robots.txt.
 * Identifies as the product crawler ("AthenumBot/1.0").
 */

export const CRAWLER_UA = "AthenumBot/1.0 (+https://example.com/bot)";

export interface BrandSuggestion {
  domain: string;
  name: string;
  description?: string;
  headlines: string[];
  productHints: string[];
  language?: string;
}

export interface AiAccessReport {
  bot: string;
  allowed: boolean;
  detail: string;
}

export interface CrawlResult {
  suggestion: BrandSuggestion;
  aiAccess: AiAccessReport[];
  sitemapUrls: string[];
  statusCode?: number;
}

function originOf(input: string): { origin: string; host: string } {
  const withScheme = /^https?:\/\//.test(input) ? input : `https://${input}`;
  const u = new URL(withScheme);
  return { origin: u.origin, host: u.hostname.replace(/^www\./, "") };
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CRAWLER_UA },
      signal: ctrl.signal,
      redirect: "follow",
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

export function parseRobots(body: string, bot: string): { allowed: boolean; detail: string } {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  let applies = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  let sawAnyGroup = false;
  for (const line of lines) {
    if (/^user-agent:/i.test(line)) {
      const agent = line.split(":")[1]?.trim().toLowerCase() ?? "";
      applies = agent === "*" || agent === bot.toLowerCase() || bot.toLowerCase().includes(agent) && agent.length > 2;
      sawAnyGroup = true;
    } else if (applies && /^disallow:/i.test(line)) {
      const v = line.slice(line.indexOf(":") + 1).trim();
      if (v) disallow.push(v);
    } else if (applies && /^allow:/i.test(line)) {
      const v = line.slice(line.indexOf(":") + 1).trim();
      if (v) allow.push(v);
    } else if (/^sitemap:/i.test(line)) {
      // ignore for per-bot check
    }
  }
  if (!sawAnyGroup) return { allowed: true, detail: "no robots.txt groups found" };
  const blockedRoot = disallow.includes("/");
  return {
    allowed: !blockedRoot || allow.includes("/"),
    detail: blockedRoot ? "disallow /" : `rules: ${disallow.length} disallow`,
  };
}

export const AI_BOTS = [
  "OAI-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "cc-bots: Bytespider",
] as const;

export async function checkAiAccess(site: string): Promise<AiAccessReport[]> {
  const { origin } = originOf(site);
  let body = "";
  try {
    const res = await fetchText(`${origin}/robots.txt`);
    body = res.body;
  } catch {
    return AI_BOTS.map((bot) => ({ bot, allowed: true, detail: "robots.txt unreachable (allowed by default)" }));
  }
  return AI_BOTS.map((bot) => {
    const r = parseRobots(body, bot);
    return { bot, allowed: r.allowed, detail: r.detail };
  });
}

export async function suggestBrand(site: string): Promise<BrandSuggestion> {
  const { host } = originOf(site);
  const fallback: BrandSuggestion = {
    domain: host,
    name: host.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    headlines: [],
    productHints: [],
  };
  try {
    const { status, body } = await fetchText(site);
    if (status >= 400) return fallback;
    const title = body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const desc =
      body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1];
    const headlines = [...body.matchAll(/<h1[^>]*>([^<]{3,120})<\/h1>/gi)].map((m) => m[1].trim()).slice(0, 5);
    const h2s = [...body.matchAll(/<h2[^>]*>([^<]{3,120})<\/h2>/gi)].map((m) => m[1].trim()).slice(0, 10);
    const ogSiteName = body.match(/property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const name = ogSiteName ?? (title ? title.split(/[|\u2013\u2014-]/)[0].trim() : fallback.name);
    return {
      domain: host,
      name: name || fallback.name,
      description: desc?.slice(0, 300),
      headlines: headlines.length ? headlines : h2s,
      productHints: h2s,
      language: body.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1],
    };
  } catch {
    return fallback;
  }
}

export async function fetchSitemap(site: string, limit = 100): Promise<string[]> {
  const { origin } = originOf(site);
  try {
    const { body } = await fetchText(`${origin}/sitemap.xml`);
    const urls = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    return urls.slice(0, limit);
  } catch {
    return [];
  }
}

export async function crawlSite(site: string): Promise<CrawlResult> {
  const [suggestion, aiAccess, sitemapUrls] = await Promise.all([
    suggestBrand(site),
    checkAiAccess(site),
    fetchSitemap(site),
  ]);
  return { suggestion, aiAccess, sitemapUrls };
}
