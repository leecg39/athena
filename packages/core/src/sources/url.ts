/** URL normalisation, registrable domains and source-type classification. */
import { getDomain } from "tldts";

export type SourceType = "owned" | "competitor" | "partner" | "third_party";
export const SOURCE_TYPES: readonly SourceType[] = ["owned", "competitor", "partner", "third_party"];

const TRACKING = /^(utm_[a-z]+|gclid|dclid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|ref|ref_src|srsltid|spm)$/i;

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** Canonical page URL: lowercase host without www, no fragment/tracking params, sorted query, no trailing slash. */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${stripWww(u.hostname)}${u.port ? `:${u.port}` : ""}${path}${query}`;
}

export function hostOf(raw: string): string {
  try {
    return stripWww(new URL(raw).hostname);
  } catch {
    return stripWww(raw.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? raw);
  }
}

/** Registrable domain; private suffixes (github.io, …) kept separate per publisher. */
export function rootDomainOf(urlOrHost: string): string {
  const host = /^[a-z]+:\/\//i.test(urlOrHost) ? hostOf(urlOrHost) : stripWww(urlOrHost);
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

export interface ClassifyContext {
  websiteDomain: string;
  competitorDomains: string[];
  overrides: { pattern: string; type: SourceType }[];
}

const covers = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function classifySource(url: string, ctx: ClassifyContext): SourceType {
  const host = hostOf(url);
  let path = "/";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* host-only input */
  }
  // 1. URL-prefix overrides (most specific first)
  const prefixed = ctx.overrides.filter((o) => o.pattern.includes("/")).sort((a, b) => b.pattern.length - a.pattern.length);
  for (const o of prefixed) {
    const [pHost, ...rest] = o.pattern.split("/");
    const pPath = `/${rest.join("/")}`.replace(/\/+$/, "");
    if (covers(host, pHost) && (path === pPath || path.startsWith(`${pPath}/`))) return o.type;
  }
  // 2. the website's own host and subdomains
  if (covers(host, stripWww(ctx.websiteDomain))) return "owned";
  // 3. domain-level overrides (longest match wins)
  const domainLevel = ctx.overrides.filter((o) => !o.pattern.includes("/") && covers(host, o.pattern)).sort((a, b) => b.pattern.length - a.pattern.length);
  if (domainLevel[0]) return domainLevel[0].type;
  // 4. tracked competitors (by registrable domain)
  const root = rootDomainOf(host);
  if (ctx.competitorDomains.some((d) => rootDomainOf(d) === root)) return "competitor";
  return "third_party";
}

/** Derived columns for storing a citation. */
export function citationRow(url: string, brandDomain: string, domainOverride?: string) {
  const domain = domainOverride ? stripWww(domainOverride) : hostOf(url);
  return {
    url,
    domain,
    rootDomain: rootDomainOf(domain),
    normalizedUrl: normalizeUrl(url),
    isBrand: covers(domain, stripWww(brandDomain)),
  };
}

/** Override patterns: "host" or "host/path", lowercase, no scheme/www/trailing slash. */
export function normalizePattern(input: string): string | null {
  const p = stripWww(input.trim().replace(/^https?:\/\//i, "")).replace(/\/+$/, "").toLowerCase();
  return /^([a-z0-9-]+\.)+[a-z]{2,63}(\/[a-z0-9._~%!$&'()*+,;=:@/-]*)?$/.test(p) ? p : null;
}
