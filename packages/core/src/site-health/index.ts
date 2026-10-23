/**
 * Site Health Engine (Task 17 — R2 real crawl & verification):
 *  - Real HTTP crawl via caller-injected SSRF-safe fetcher (`SiteHealthFetcher`)
 *  - RFC 9309 `robots.txt` evaluation across 10 AI search & training crawlers
 *  - Real `/sitemap.xml` and `/llms.txt` inspection + JSON-LD `@type` extraction
 *  - Staging vs Production live comparison (`runStagingReleaseCheck`)
 *  - Optimization Board (`needs_edit` -> `staged` -> `verified_live`) + live SHA-256 verification
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  type Db,
  type SiteHealthPageMeta,
  contentItems,
  kbFacts,
  siteHealthPages,
  websites,
} from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { decodeEntities } from "../shared/html";

export type SiteHealthFetcher = (url: string) => Promise<{ status: number; body: string } | null>;

export const AI_CRAWLER_BOTS = [
  { bot: "OAI-SearchBot", owner: "OpenAI", purpose: "ChatGPT Search index" },
  { bot: "ChatGPT-User", owner: "OpenAI", purpose: "ChatGPT live browsing" },
  { bot: "GPTBot", owner: "OpenAI", purpose: "OpenAI model training" },
  { bot: "Claude-SearchBot", owner: "Anthropic", purpose: "Claude Search index" },
  { bot: "Claude-User", owner: "Anthropic", purpose: "Claude live citation fetch" },
  { bot: "ClaudeBot", owner: "Anthropic", purpose: "Anthropic model training" },
  { bot: "PerplexityBot", owner: "Perplexity", purpose: "Perplexity answer engine" },
  { bot: "Google-Extended", owner: "Google", purpose: "Gemini & AI Overview grounding" },
  { bot: "Applebot-Extended", owner: "Apple", purpose: "Apple Intelligence grounding" },
  { bot: "AthenaBot", owner: "AthenaHQ", purpose: "Live AEO content verification" },
] as const;

export type OptimizationStage = "healthy" | "needs_edit" | "staged" | "verified_live";

export interface SiteHealthKeywordRow {
  pageId: string;
  url: string;
  path: string;
  title: string;
  keyword: string;
  position: number;
  volume: number;
  change: number;
  aiAccessible: boolean;
}

export interface SiteHealthBotSummary {
  bot: string;
  owner: string;
  purpose: string;
  allowedPages: number;
  blockedPages: number;
  status: "allowed" | "partial" | "blocked";
  ruleSummary: string;
}

export interface SiteHealthStagingRow {
  pageId: string;
  url: string;
  path: string;
  title: string;
  prodStatus: number;
  stagingStatus: number;
  prodAiAccessible: boolean;
  stagingAiAccessible: boolean;
  hasRegression: boolean;
  diffSummary: string;
}

export interface SiteHealthPropertyGroup {
  property: string;
  pageCount: number;
  healthyCount: number;
  aiAccessiblePct: number;
  inSitemapCount: number;
}

export interface SiteHealthPageItem {
  id: string;
  websiteId: string;
  url: string;
  path: string;
  title: string;
  property: string;
  statusCode: number;
  aiAccessible: boolean;
  inSitemap: boolean;
  llmsTxtPresent: boolean;
  schemaMarkup: string[];
  keywords: { keyword: string; position: number; volume: number; change: number }[];
  robotsBots: {
    bot: string;
    owner: string;
    purpose: string;
    status: "allowed" | "blocked";
    rule: string;
  }[];
  stagingStatusCode: number;
  stagingAiAccessible: boolean;
  stagingDiffSummary: string;
  optimizationStatus: OptimizationStage;
  optimizationRecommendation: string;
  verifiedAt: string | null;
  verificationHash: string | null;
  healthStatus: "pass" | "warn" | "fail";
  healthDetail: string;
  lastCheckedAt: Date | null;
}

export interface SiteHealthSummary {
  stats: {
    totalPages: number;
    indexedPages: number;
    aiAccessiblePct: number;
    totalKeywords: number;
    avgKeywordPosition: number;
    failedChecksCount: number;
    stagingRegressionsCount: number;
    verifiedLiveCount: number;
    needsOptimizationCount: number;
  };
  pages: SiteHealthPageItem[];
  botAccessMatrix: SiteHealthBotSummary[];
  keywords: SiteHealthKeywordRow[];
  stagingComparisons: SiteHealthStagingRow[];
  properties: SiteHealthPropertyGroup[];
  optimizations: {
    needsEdit: SiteHealthPageItem[];
    staged: SiteHealthPageItem[];
    verifiedLive: SiteHealthPageItem[];
  };
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "::1"
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function normalizeSitePageUrl(rawUrl: string, siteDomain: string): { url: string; path: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new DomainError("Page URL or path is required");
  if (/^(javascript|data|file|vbscript):/i.test(trimmed)) {
    throw new DomainError("Unsupported URL scheme");
  }
  const parsed = trimmed.startsWith("/")
    ? new URL(trimmed, `https://${siteDomain}`)
    : new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DomainError("Only http and https URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (isPrivateOrLoopbackHost(host)) {
    throw new DomainError("Private, loopback, or internal URLs are not allowed");
  }
  const cleanSiteDomain = siteDomain.toLowerCase().replace(/^www\./, "");
  if (host !== cleanSiteDomain && !host.endsWith(`.${cleanSiteDomain}`)) {
    throw new DomainError(
      `Site Health URLs must belong to your workspace domain (${cleanSiteDomain}) or its subdomains`,
    );
  }
  const cleanPath = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
  return { url: `https://${host}${cleanPath}`, path: cleanPath };
}

interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

function parseRobotsTxt(body: string): { groups: RobotsGroup[]; sitemaps: string[] } {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === "sitemap" && val) sitemaps.push(val);
      else if (current && (key === "allow" || key === "disallow") && val) {
        current.rules.push({ allow: key === "allow", pattern: val });
      }
    }
  }
  return { groups, sitemaps };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

function evaluatePageBots(
  robots: { groups: RobotsGroup[] } | null,
  path: string,
  html: string,
): NonNullable<SiteHealthPageMeta["robotsBots"]> {
  const metaNoAi = /<meta[^>]+name=["']?(?:robots|ai-robots)["']?[^>]+content=["'][^"']*\b(?:noindex|noai)\b/i.test(html);
  return AI_CRAWLER_BOTS.map((b) => {
    if (metaNoAi) {
      return { bot: b.bot, owner: b.owner, purpose: b.purpose, status: "blocked", rule: "Meta robots: noindex/noai" };
    }
    if (!robots) {
      return { bot: b.bot, owner: b.owner, purpose: b.purpose, status: "allowed", rule: "No robots.txt restriction" };
    }
    const token = b.bot.toLowerCase();
    let groups = robots.groups.filter((g) => g.agents.includes(token));
    let groupName: string = b.bot;
    if (!groups.length) {
      groups = robots.groups.filter((g) => g.agents.includes("*"));
      groupName = "*";
    }
    let best: { allow: boolean; pattern: string } | null = null;
    for (const rule of groups.flatMap((g) => g.rules)) {
      if (!patternMatches(rule.pattern, path)) continue;
      const len = rule.pattern.replace(/\$$/, "").length;
      const bestLen = best ? best.pattern.replace(/\$$/, "").length : -1;
      if (len > bestLen || (len === bestLen && rule.allow && best && !best.allow)) best = rule;
    }
    const allowed = best ? best.allow : true;
    const ruleText = best
      ? `${best.allow ? "Allow" : "Disallow"}: ${best.pattern} (User-agent: ${groupName})`
      : `Allow: / (User-agent: ${groupName})`;
    return { bot: b.bot, owner: b.owner, purpose: b.purpose, status: allowed ? "allowed" : "blocked", rule: ruleText };
  });
}

function extractHtmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  return t ? t.slice(0, 200) : null;
}

function extractJsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scriptRe)) {
    for (const tm of m[1].matchAll(/"@type"\s*:\s*"([^"]{1,60})"/g)) {
      types.add(tm[1]);
    }
  }
  return [...types].slice(0, 10);
}

function inferProperty(path: string): string {
  if (/^\/(docs|api|reference|sdk)(\/|$)/i.test(path)) return "Documentation & Specs";
  if (/^\/(blog|guides|articles|learn|news)(\/|$)/i.test(path)) return "Blog & Guides";
  return "Marketing & Core";
}

function deriveHealthStatus(row: {
  statusCode: number;
  aiAccessible: boolean;
  inSitemap: boolean;
  meta: SiteHealthPageMeta;
}): { healthStatus: "pass" | "warn" | "fail"; healthDetail: string } {
  if (row.statusCode === 0) {
    return { healthStatus: "fail", healthDetail: "Unreachable or not crawled yet" };
  }
  if (row.statusCode >= 400) {
    return {
      healthStatus: "fail",
      healthDetail: `${row.statusCode} HTTP error · ${row.inSitemap ? "remove stale URL from sitemap.xml" : "not in sitemap"}`,
    };
  }
  const blockedBots = (row.meta.robotsBots ?? []).filter((b) => b.status === "blocked").map((b) => b.bot);
  if (!row.aiAccessible || blockedBots.length >= 4) {
    return {
      healthStatus: "fail",
      healthDetail: `AI crawlers blocked (${blockedBots.slice(0, 3).join(", ") || "robots.txt Disallow"})`,
    };
  }
  if (blockedBots.length > 0) {
    return { healthStatus: "warn", healthDetail: `robots.txt blocks ${blockedBots.join(", ")}` };
  }
  if (!row.inSitemap) {
    return { healthStatus: "warn", healthDetail: `${row.statusCode} OK · missing from /sitemap.xml` };
  }
  if (row.meta.llmsTxtPresent === false) {
    return { healthStatus: "warn", healthDetail: `${row.statusCode} OK · missing /llms.txt` };
  }
  return { healthStatus: "pass", healthDetail: `${row.statusCode} OK · All AI search bots allowed · In sitemap.xml` };
}

function recommendationFor(statusCode: number, inSitemap: boolean, llmsTxt: boolean, schemas: string[], blocked: string[]): string {
  if (statusCode === 0) return "Crawl could not reach this URL — check DNS and HTTPS availability.";
  if (statusCode >= 400) {
    return inSitemap
      ? `HTTP ${statusCode} — remove this broken URL from /sitemap.xml or restore the page.`
      : `HTTP ${statusCode} — restore the page or configure a 301 redirect.`;
  }
  if (blocked.length > 0) {
    return `Unblock ${blocked.slice(0, 4).join(", ")} in /robots.txt so AI search engines can cite this page.`;
  }
  if (!inSitemap) return "Add this URL to /sitemap.xml so AI crawlers discover it reliably.";
  if (!schemas.length) return "Add JSON-LD structured data (e.g. Article, FAQPage, Product) to improve citation accuracy.";
  if (!llmsTxt) return "Publish /llms.txt at the domain root with a concise index of key pages.";
  return "All crawlability, robots.txt, sitemap.xml, and structured data checks passed.";
}

async function discoverCandidatePaths(
  db: Db,
  site: WebsiteRow,
  sitemapXml: string,
): Promise<{ paths: string[]; sitemapSet: Set<string> }> {
  const sitemapSet = new Set<string>();
  const ordered: string[] = ["/"];
  const seen = new Set<string>(["/"]);
  const add = (raw: string, fromSitemap = false) => {
    try {
      const { path } = normalizeSitePageUrl(raw, site.domain);
      if (fromSitemap) sitemapSet.add(path);
      if (!seen.has(path) && ordered.length < 20) {
        seen.add(path);
        ordered.push(path);
      }
    } catch {
      // ignore off-domain or malformed URLs
    }
  };
  for (const m of sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) add(m[1], true);
  const [existing, facts, items] = await Promise.all([
    db.select({ url: siteHealthPages.url }).from(siteHealthPages).where(eq(siteHealthPages.websiteId, site.id)),
    db.select({ url: kbFacts.sourceUrl }).from(kbFacts).where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt))).limit(10),
    db.select({ url: contentItems.targetUrl }).from(contentItems).where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt))).limit(10),
  ]);
  for (const r of [...existing, ...facts, ...items]) if (r.url) add(r.url, false);
  return { paths: ordered, sitemapSet };
}

export async function runSiteHealthCrawlForSite(
  db: Db,
  site: WebsiteRow,
  fetchPage: SiteHealthFetcher,
  actorId?: string,
): Promise<{ created: number; updated: number; total: number }> {
  const origin = `https://${site.domain}`;
  const [robotsRes, llmsRes, sitemapRes] = await Promise.all([
    fetchPage(`${origin}/robots.txt`),
    fetchPage(`${origin}/llms.txt`),
    fetchPage(`${origin}/sitemap.xml`),
  ]);
  const parsedRobots = robotsRes && robotsRes.status >= 200 && robotsRes.status < 300 ? parseRobotsTxt(robotsRes.body) : null;
  const llmsTxtPresent = Boolean(llmsRes && llmsRes.status >= 200 && llmsRes.status < 300 && llmsRes.body.trim());
  const sitemapXml = sitemapRes && sitemapRes.status >= 200 && sitemapRes.status < 300 ? sitemapRes.body : "";
  const { paths, sitemapSet } = await discoverCandidatePaths(db, site, sitemapXml);
  const fetched = await Promise.all(paths.map(async (p) => [p, await fetchPage(`${origin}${p}`)] as const));

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx.select().from(siteHealthPages).where(eq(siteHealthPages.websiteId, site.id));
    const existingByUrl = new Map(existing.map((r) => [r.url.toLowerCase(), r]));
    let created = 0;
    let updated = 0;
    const now = new Date();

    for (const [path, res] of fetched) {
      const fullUrl = `${origin}${path}`;
      const match = existingByUrl.get(fullUrl.toLowerCase()) ?? existingByUrl.get(path.toLowerCase());
      const prevMeta = (match?.meta ?? {}) as SiteHealthPageMeta;
      const statusCode = res?.status ?? 0;
      const body = res?.body ?? "";
      const robotsBots = evaluatePageBots(parsedRobots, path, body);
      const blocked = robotsBots.filter((b) => b.status === "blocked").map((b) => b.bot);
      const aiAccessible = statusCode >= 200 && statusCode < 400 && blocked.length < 4;
      const inSitemap = sitemapSet.has(path);
      const schemaMarkup = extractJsonLdTypes(body);
      const title = extractHtmlTitle(body) ?? match?.title ?? `${site.name} (${path})`;
      const rec = recommendationFor(statusCode, inSitemap, llmsTxtPresent, schemaMarkup, blocked);
      const { healthStatus } = deriveHealthStatus({ statusCode, aiAccessible, inSitemap, meta: { robotsBots, llmsTxtPresent } });
      const keepStage = prevMeta.optimizationStatus === "verified_live" || prevMeta.optimizationStatus === "staged";
      const meta: SiteHealthPageMeta = {
        ...prevMeta,
        property: prevMeta.property ?? inferProperty(path),
        robotsBots,
        llmsTxtPresent,
        schemaMarkup,
        stagingStatusCode: prevMeta.stagingStatusCode,
        stagingAiAccessible: prevMeta.stagingAiAccessible,
        stagingDiffSummary: prevMeta.stagingDiffSummary ?? "Not checked against staging yet",
        optimizationStatus: keepStage ? prevMeta.optimizationStatus : healthStatus === "pass" ? "healthy" : "needs_edit",
        optimizationRecommendation: keepStage ? (prevMeta.optimizationRecommendation ?? rec) : rec,
      };
      if (match) {
        await tx
          .update(siteHealthPages)
          .set({ url: fullUrl, title, statusCode, aiAccessible, inSitemap, meta, lastCheckedAt: now })
          .where(eq(siteHealthPages.id, match.id));
        updated++;
      } else {
        await tx.insert(siteHealthPages).values({
          websiteId: site.id,
          url: fullUrl,
          title,
          statusCode,
          aiAccessible,
          inSitemap,
          keywords: [],
          meta,
          lastCheckedAt: now,
        });
        created++;
      }
    }
    if (actorId) {
      await logActivity(tx, {
        organizationId: site.organizationId,
        websiteId: site.id,
        userId: actorId,
        entityType: "site_health",
        entityId: site.id,
        change: "crawled",
        after: { created, updated },
      });
    }
    return { created, updated, total: existing.length + created };
  });
}

export async function runSiteHealthCrawl(
  db: Db,
  input: { actorId: string; websiteId: string; fetchPage: SiteHealthFetcher },
): Promise<{ created: number; updated: number; total: number }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  return runSiteHealthCrawlForSite(db, site, input.fetchPage, input.actorId);
}

export async function runStagingReleaseCheck(
  db: Db,
  rawInput: { actorId: string; websiteId: string; stagingHost?: string; fetchPage: SiteHealthFetcher },
): Promise<{ checked: number; regressions: number; stagingHost: string }> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  const rawHost = (rawInput.stagingHost ?? `staging.${site.domain}`).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!rawHost || isPrivateOrLoopbackHost(rawHost)) {
    throw new DomainError("Invalid or private staging hostname");
  }
  const pages = await db.select().from(siteHealthPages).where(eq(siteHealthPages.websiteId, site.id));
  const robotsRes = await rawInput.fetchPage(`https://${rawHost}/robots.txt`);
  const stagingRobots = robotsRes && robotsRes.status >= 200 && robotsRes.status < 300 ? parseRobotsTxt(robotsRes.body) : null;
  const checks = await Promise.all(
    pages.map(async (p) => {
      const path = new URL(p.url.startsWith("http") ? p.url : `https://${site.domain}${p.url}`).pathname || "/";
      const res = await rawInput.fetchPage(`https://${rawHost}${path}`);
      return { page: p, path, res };
    }),
  );

  return db.transaction(async (tx) => {
    let regressions = 0;
    const now = new Date();
    for (const { page, path, res } of checks) {
      const meta = (page.meta ?? {}) as SiteHealthPageMeta;
      const stagingStatus = res?.status ?? 0;
      const bots = evaluatePageBots(stagingRobots, path, res?.body ?? "");
      const blocked = bots.filter((b) => b.status === "blocked").map((b) => b.bot);
      const stagingAi = stagingStatus >= 200 && stagingStatus < 400 && blocked.length < 4;
      const hasRegression = stagingStatus === 0 || stagingStatus >= 400 || !stagingAi || blocked.length > 0;
      if (hasRegression) regressions++;
      const diffSummary =
        stagingStatus === 0
          ? `Staging (${rawHost}) unreachable`
          : hasRegression
            ? `Staging (${rawHost}): HTTP ${stagingStatus} · ${blocked.length ? `Blocked: ${blocked.join(", ")}` : "AI access restricted"}`
            : `Staging (${rawHost}) OK: HTTP ${stagingStatus} · All 10 AI crawlers allowed`;
      await tx
        .update(siteHealthPages)
        .set({
          meta: { ...meta, stagingStatusCode: stagingStatus, stagingAiAccessible: stagingAi, stagingDiffSummary: diffSummary },
          lastCheckedAt: now,
        })
        .where(eq(siteHealthPages.id, page.id));
    }
    await logActivity(tx, {
      organizationId: site.organizationId,
      websiteId: site.id,
      userId: rawInput.actorId,
      entityType: "site_health",
      entityId: site.id,
      change: "staging_release_checked",
      after: { stagingHost: rawHost, checked: pages.length, regressions },
    });
    return { checked: pages.length, regressions, stagingHost: rawHost };
  });
}

const createSiteHealthPageSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  url: z.string().trim().min(1, "Page URL or path is required").max(500),
  title: z.string().trim().min(2, "Page title is required").max(200),
  property: z.string().trim().min(2).max(100).default("Marketing & Core"),
  keyword: z.string().trim().max(120).optional(),
  position: z.number().int().min(1).max(100).optional(),
});

export async function createSiteHealthPage(
  db: Db,
  rawInput: z.input<typeof createSiteHealthPageSchema>,
): Promise<{ id: string; url: string }> {
  const parsed = createSiteHealthPageSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid page input");
  }
  const input = parsed.data;
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const normalized = normalizeSitePageUrl(input.url, site.domain);

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx.select().from(siteHealthPages).where(eq(siteHealthPages.websiteId, site.id));
    if (existing.some((r) => r.url.toLowerCase() === normalized.url.toLowerCase())) {
      throw new DomainError(`Page "${normalized.path}" is already tracked in Site Health`);
    }
    const keywords = input.keyword
      ? [{ keyword: input.keyword, position: input.position ?? 0, volume: 0, change: 0 }]
      : [];
    const meta: SiteHealthPageMeta = {
      property: input.property,
      robotsBots: evaluatePageBots(null, normalized.path, ""),
      llmsTxtPresent: false,
      schemaMarkup: [],
      stagingDiffSummary: "Not checked against staging yet",
      optimizationStatus: "needs_edit",
      optimizationRecommendation: "Run Crawl now or Live Verify to audit this page.",
      verifiedAt: null,
      verificationHash: null,
    };
    const [inserted] = await tx
      .insert(siteHealthPages)
      .values({
        websiteId: site.id,
        url: normalized.url,
        title: input.title,
        statusCode: 0,
        aiAccessible: false,
        inSitemap: false,
        keywords,
        meta,
        lastCheckedAt: null,
      })
      .returning();
    await logActivity(tx, {
      organizationId: site.organizationId,
      websiteId: site.id,
      userId: input.actorId,
      entityType: "site_health_page",
      entityId: inserted!.id,
      change: "created",
      after: { url: normalized.url, property: input.property },
    });
    return { id: inserted!.id, url: normalized.url };
  });
}

export async function updatePageOptimization(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    pageId: string;
    optimizationStatus: OptimizationStage;
    recommendation?: string;
  },
): Promise<{ id: string; optimizationStatus: OptimizationStage }> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  const [existing] = await db
    .select()
    .from(siteHealthPages)
    .where(and(eq(siteHealthPages.id, rawInput.pageId), eq(siteHealthPages.websiteId, site.id)));
  if (!existing) throw new NotFoundError("Site Health page not found");
  const prevMeta = (existing.meta ?? {}) as SiteHealthPageMeta;
  const nextMeta: SiteHealthPageMeta = {
    ...prevMeta,
    optimizationStatus: rawInput.optimizationStatus,
    optimizationRecommendation:
      rawInput.recommendation?.trim() || prevMeta.optimizationRecommendation || "Optimization status updated.",
  };
  await db
    .update(siteHealthPages)
    .set({ meta: nextMeta, lastCheckedAt: new Date() })
    .where(and(eq(siteHealthPages.id, existing.id), eq(siteHealthPages.websiteId, site.id)));
  await logActivity(db, {
    organizationId: site.organizationId,
    websiteId: site.id,
    userId: rawInput.actorId,
    entityType: "site_health_page",
    entityId: existing.id,
    change: "optimization_updated",
    after: { url: existing.url, optimizationStatus: rawInput.optimizationStatus },
  });
  return { id: existing.id, optimizationStatus: rawInput.optimizationStatus };
}

export async function verifyLivePageContent(
  db: Db,
  rawInput: { actorId: string; websiteId: string; pageId: string; fetchPage: SiteHealthFetcher },
): Promise<{ id: string; url: string; verificationHash: string; verifiedAt: string }> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  const [existing] = await db
    .select()
    .from(siteHealthPages)
    .where(and(eq(siteHealthPages.id, rawInput.pageId), eq(siteHealthPages.websiteId, site.id)));
  if (!existing) throw new NotFoundError("Site Health page not found");

  const path = new URL(existing.url.startsWith("http") ? existing.url : `https://${site.domain}${existing.url}`).pathname || "/";
  const [pageRes, robotsRes] = await Promise.all([
    rawInput.fetchPage(existing.url),
    rawInput.fetchPage(`https://${site.domain}/robots.txt`),
  ]);
  if (!pageRes || pageRes.status < 200 || pageRes.status >= 400) {
    throw new DomainError(`Live page returned HTTP ${pageRes?.status ?? "unreachable"} — fix the live URL before marking it verified`);
  }
  const parsedRobots = robotsRes && robotsRes.status >= 200 && robotsRes.status < 300 ? parseRobotsTxt(robotsRes.body) : null;
  const robotsBots = evaluatePageBots(parsedRobots, path, pageRes.body);
  const blocked = robotsBots.filter((b) => b.status === "blocked").map((b) => b.bot);
  if (blocked.length >= 4) {
    throw new DomainError(`Live page still blocks AI crawlers (${blocked.slice(0, 4).join(", ")})`);
  }

  const nowIso = new Date().toISOString();
  const hash = "sha256-" + createHash("sha256").update(pageRes.body).digest("hex").slice(0, 16);
  const prevMeta = (existing.meta ?? {}) as SiteHealthPageMeta;
  const schemas = extractJsonLdTypes(pageRes.body);
  const nextMeta: SiteHealthPageMeta = {
    ...prevMeta,
    robotsBots,
    schemaMarkup: schemas.length ? schemas : (prevMeta.schemaMarkup ?? []),
    optimizationStatus: "verified_live",
    optimizationRecommendation: `Live content verified (${hash}).`,
    verifiedAt: nowIso,
    verificationHash: hash,
  };
  await db
    .update(siteHealthPages)
    .set({
      title: extractHtmlTitle(pageRes.body) ?? existing.title,
      statusCode: pageRes.status,
      aiAccessible: true,
      meta: nextMeta,
      lastCheckedAt: new Date(),
    })
    .where(and(eq(siteHealthPages.id, existing.id), eq(siteHealthPages.websiteId, site.id)));
  await logActivity(db, {
    organizationId: site.organizationId,
    websiteId: site.id,
    userId: rawInput.actorId,
    entityType: "site_health_page",
    entityId: existing.id,
    change: "verified_live",
    after: { url: existing.url, verificationHash: hash, verifiedAt: nowIso },
  });
  return { id: existing.id, url: existing.url, verificationHash: hash, verifiedAt: nowIso };
}

export async function deleteSiteHealthPage(
  db: Db,
  rawInput: { actorId: string; websiteId: string; pageId: string },
): Promise<void> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  const [existing] = await db
    .select()
    .from(siteHealthPages)
    .where(and(eq(siteHealthPages.id, rawInput.pageId), eq(siteHealthPages.websiteId, site.id)));
  if (!existing) throw new NotFoundError("Site Health page not found");
  await db
    .delete(siteHealthPages)
    .where(and(eq(siteHealthPages.id, existing.id), eq(siteHealthPages.websiteId, site.id)));
  await logActivity(db, {
    organizationId: site.organizationId,
    websiteId: site.id,
    userId: rawInput.actorId,
    entityType: "site_health_page",
    entityId: existing.id,
    change: "deleted",
    before: { url: existing.url },
  });
}

function toPageItem(r: typeof siteHealthPages.$inferSelect, domain: string): SiteHealthPageItem {
  const meta = (r.meta ?? {}) as SiteHealthPageMeta;
  const statusCode = r.statusCode ?? 0;
  const aiAccessible = r.aiAccessible ?? false;
  const inSitemap = r.inSitemap ?? false;
  let path = "/";
  try {
    path = new URL(r.url.startsWith("http") ? r.url : `https://${domain}${r.url}`).pathname || "/";
  } catch {
    path = r.url;
  }
  const robotsBots = meta.robotsBots ?? evaluatePageBots(null, path, "");
  const { healthStatus, healthDetail } = deriveHealthStatus({
    statusCode,
    aiAccessible,
    inSitemap,
    meta: { ...meta, robotsBots },
  });
  return {
    id: r.id,
    websiteId: r.websiteId,
    url: r.url,
    path,
    title: r.title ?? path,
    property: meta.property ?? inferProperty(path),
    statusCode,
    aiAccessible,
    inSitemap,
    llmsTxtPresent: meta.llmsTxtPresent ?? false,
    schemaMarkup: meta.schemaMarkup ?? [],
    keywords: (r.keywords ?? []).map((k) => ({
      keyword: k.keyword,
      position: k.position,
      volume: k.volume ?? 0,
      change: k.change ?? 0,
    })),
    robotsBots,
    stagingStatusCode: meta.stagingStatusCode ?? 0,
    stagingAiAccessible: meta.stagingAiAccessible ?? false,
    stagingDiffSummary: meta.stagingDiffSummary ?? "Not checked against staging yet",
    optimizationStatus: meta.optimizationStatus ?? (healthStatus === "pass" ? "healthy" : "needs_edit"),
    optimizationRecommendation: meta.optimizationRecommendation ?? healthDetail,
    verifiedAt: meta.verifiedAt ?? null,
    verificationHash: meta.verificationHash ?? null,
    healthStatus,
    healthDetail,
    lastCheckedAt: r.lastCheckedAt,
  };
}

export async function getSiteHealthSummary(db: Db, websiteId: string): Promise<SiteHealthSummary> {
  const [site] = await db
    .select()
    .from(websites)
    .where(and(eq(websites.id, websiteId), isNull(websites.deletedAt)));
  if (!site) throw new NotFoundError("Website not found");

  const rows = await db
    .select()
    .from(siteHealthPages)
    .where(eq(siteHealthPages.websiteId, websiteId))
    .orderBy(asc(siteHealthPages.createdAt));

  const pages = rows.map((r) => toPageItem(r, site.domain));

  const botAccessMatrix: SiteHealthBotSummary[] = AI_CRAWLER_BOTS.map((b) => {
    let allowedPages = 0;
    let blockedPages = 0;
    for (const p of pages) {
      const entry = p.robotsBots.find((rb) => rb.bot === b.bot);
      if (!entry || entry.status === "allowed") allowedPages++;
      else blockedPages++;
    }
    const status: SiteHealthBotSummary["status"] =
      pages.length === 0 || blockedPages === 0 ? "allowed" : allowedPages === 0 ? "blocked" : "partial";
    const ruleSummary =
      pages.length === 0
        ? "No pages crawled yet"
        : blockedPages === 0
          ? `Allowed on all ${allowedPages} pages`
          : `Allowed on ${allowedPages}/${pages.length} pages (${blockedPages} blocked)`;
    return { bot: b.bot, owner: b.owner, purpose: b.purpose, allowedPages, blockedPages, status, ruleSummary };
  });

  const keywords: SiteHealthKeywordRow[] = pages
    .flatMap((p) =>
      p.keywords.map((k) => ({
        pageId: p.id,
        url: p.url,
        path: p.path,
        title: p.title,
        keyword: k.keyword,
        position: k.position,
        volume: k.volume,
        change: k.change,
        aiAccessible: p.aiAccessible,
      })),
    )
    .sort((a, b) => a.position - b.position);

  const stagingComparisons: SiteHealthStagingRow[] = pages
    .filter((p) => p.stagingStatusCode > 0 || p.stagingDiffSummary !== "Not checked against staging yet")
    .map((p) => ({
      pageId: p.id,
      url: p.url,
      path: p.path,
      title: p.title,
      prodStatus: p.statusCode,
      stagingStatus: p.stagingStatusCode,
      prodAiAccessible: p.aiAccessible,
      stagingAiAccessible: p.stagingAiAccessible,
      hasRegression: p.stagingStatusCode === 0 || p.stagingStatusCode >= 400 || !p.stagingAiAccessible,
      diffSummary: p.stagingDiffSummary,
    }));

  const propMap = new Map<string, SiteHealthPageItem[]>();
  for (const p of pages) propMap.set(p.property, [...(propMap.get(p.property) ?? []), p]);
  const properties: SiteHealthPropertyGroup[] = Array.from(propMap.entries()).map(([property, group]) => ({
    property,
    pageCount: group.length,
    healthyCount: group.filter((g) => g.healthStatus === "pass").length,
    aiAccessiblePct: group.length > 0 ? +((group.filter((g) => g.aiAccessible).length / group.length) * 100).toFixed(1) : 0,
    inSitemapCount: group.filter((g) => g.inSitemap).length,
  }));

  const needsEdit = pages.filter((p) => p.optimizationStatus === "needs_edit");
  const staged = pages.filter((p) => p.optimizationStatus === "staged");
  const verifiedLive = pages.filter((p) => p.optimizationStatus === "verified_live" || p.optimizationStatus === "healthy");
  const totalPages = pages.length;
  const aiAccessibleCount = pages.filter((p) => p.aiAccessible).length;

  return {
    stats: {
      totalPages,
      indexedPages: pages.filter((p) => p.statusCode >= 200 && p.statusCode < 400 && p.inSitemap).length,
      aiAccessiblePct: totalPages > 0 ? +((aiAccessibleCount / totalPages) * 100).toFixed(1) : 0,
      totalKeywords: keywords.length,
      avgKeywordPosition: keywords.length > 0 ? +(keywords.reduce((a, k) => a + k.position, 0) / keywords.length).toFixed(1) : 0,
      failedChecksCount: pages.filter((p) => p.healthStatus !== "pass").length,
      stagingRegressionsCount: stagingComparisons.filter((s) => s.hasRegression).length,
      verifiedLiveCount: verifiedLive.length,
      needsOptimizationCount: needsEdit.length + staged.length,
    },
    pages,
    botAccessMatrix,
    keywords,
    stagingComparisons,
    properties,
    optimizations: { needsEdit, staged, verifiedLive },
  };
}
