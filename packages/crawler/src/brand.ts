/** Brand profile extraction from a homepage's HTML. */
import { parse, type HTMLElement } from "node-html-parser";

export interface BrandSuggestion {
  domain: string;
  name: string;
  description?: string;
  headlines: string[];
  productHints: string[];
  language?: string;
  /** legal/organization name from JSON-LD, when present */
  organizationName?: string;
}

export function domainOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase();
  }
}

function clean(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function nameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function meta(root: HTMLElement, attr: "name" | "property", key: string): string | undefined {
  const el = root.querySelectorAll("meta").find((m) => (m.getAttribute(attr) ?? "").toLowerCase() === key);
  const v = clean(el?.getAttribute("content"));
  return v || undefined;
}

function organizationFromJsonLd(root: HTMLElement): string | undefined {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data: unknown = JSON.parse(script.rawText);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const graph = (item as { "@graph"?: unknown[] })?.["@graph"];
        for (const node of Array.isArray(graph) ? graph : [item]) {
          const n = node as { "@type"?: string | string[]; name?: unknown };
          const types = Array.isArray(n?.["@type"]) ? n["@type"] : [n?.["@type"]];
          if (types.some((t) => t === "Organization" || t === "Corporation") && typeof n.name === "string") {
            return clean(n.name);
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return undefined;
}

/** Choose the title segment naming the brand: the one matching the domain label, else the first. */
function bestTitleSegment(title: string, domain: string): string | undefined {
  if (!title) return undefined;
  const segments = title
    .split(/\s+[|\\–—·•:-]\s+|\s*[|\\–—·•]\s*|:\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const label = (domain.split(".")[0] ?? "").replace(/[^a-z0-9]/g, "");
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = label ? segments.find((s) => squash(s) === label || squash(s).includes(label) || (squash(s).length > 2 && label.includes(squash(s)))) : undefined;
  return match ?? segments[0];
}

export function extractBrand(html: string, pageUrl: string): BrandSuggestion {
  const domain = domainOf(pageUrl);
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } });
  const title = clean(root.querySelector("title")?.text);
  const siteName = meta(root, "property", "og:site_name");
  const titleLead = bestTitleSegment(title, domain);
  const description = meta(root, "name", "description") ?? meta(root, "property", "og:description");
  const headlines = root
    .querySelectorAll("h1")
    .map((h) => clean(h.text))
    .filter((t) => t.length >= 3 && t.length <= 160)
    .slice(0, 5);
  const productHints = root
    .querySelectorAll("h2")
    .map((h) => clean(h.text))
    .filter((t) => t.length >= 3 && t.length <= 120)
    .slice(0, 10);
  return {
    domain,
    name: siteName || titleLead || nameFromDomain(domain),
    description: description?.slice(0, 300),
    headlines,
    productHints,
    language: root.querySelector("html")?.getAttribute("lang") || undefined,
    organizationName: organizationFromJsonLd(root),
  };
}
