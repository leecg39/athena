import { DomainError } from "../org/errors";

export const CONTENT_STATUSES = ["idea", "brief", "draft", "review", "approved", "published"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CMS_PROVIDERS = [
  "wordpress",
  "webflow",
  "contentful",
  "sanity",
  "wix",
  "framer",
  "payload",
  "shopify",
] as const;
export type CmsProvider = (typeof CMS_PROVIDERS)[number];

export const CMS_PROVIDER_LABELS: Record<CmsProvider, string> = {
  wordpress: "WordPress",
  webflow: "Webflow",
  contentful: "Contentful",
  sanity: "Sanity",
  wix: "Wix",
  framer: "Framer",
  payload: "Payload CMS",
  shopify: "Shopify",
};

export function normKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return s || "article";
}

export function normalizeContentUrl(raw: string | null | undefined, brandDomain: string): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  const withProto = trimmed.startsWith("/")
    ? `https://${brandDomain}${trimmed}`
    : /^https?:\/\//i.test(trimmed)
      ? trimmed
      : trimmed.includes("://") || /^[a-z]+:/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new DomainError("Target URL must use http or https");
    }
    u.hash = "";
    const path = u.pathname === "/" ? "/" : u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError("Invalid target URL");
  }
}

export function validateSafeCmsEndpointUrl(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new DomainError("CMS endpoint URL must be a valid http or https URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new DomainError("CMS endpoint URL must use http or https");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("169.254.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new DomainError("CMS endpoint URL cannot point to private or loopback networks");
  }
  return u.toString();
}

export function maskConfigSecrets(config: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config ?? {})) {
    if (typeof v !== "string") continue;
    if (/(token|secret|key|password|credential)/i.test(k) && v.length > 0) {
      out[k] = v.length > 6 ? `${v.slice(0, 3)}••••••••` : "••••••••";
    } else {
      out[k] = v;
    }
  }
  return out;
}
