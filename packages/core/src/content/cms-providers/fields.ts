/** Validators for CMS connection fields. Each returns the normalized value or throws a DomainError. */
import { z } from "zod";
import { DomainError } from "../../org/errors";
import { validateSafeCmsEndpointUrl } from "../shared";

export const text = (max: number) => (v: string) => z.string().trim().min(1).max(max).parse(v);

/** A credential: one line of visible ASCII (keeps header values intact). */
export const token = (max: number) => (v: string) => {
  const s = v.trim();
  if (!/^[\x21-\x7e]+$/.test(s) || s.length > max) throw new DomainError("Paste the key exactly as issued (one line, no spaces)");
  return s;
};

export const pattern = (re: RegExp, message: string) => (v: string) => {
  const s = v.trim();
  if (!re.test(s)) throw new DomainError(message);
  return s;
};

export const oneOf = (options: readonly string[], label: string) => (v: string) => {
  const s = v.trim();
  if (!options.includes(s)) throw new DomainError(`${label} must be one of: ${options.join(", ")}`);
  return s;
};

/** A field id/name inside the CMS schema (letters, digits, underscores and dashes). */
export const fieldKey = (label: string) => pattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, `${label} is a field ID such as "title" (letters, numbers, _ or -)`);

export const httpsUrl = (v: string) => {
  const url = validateSafeCmsEndpointUrl(v);
  if (!url || !url.startsWith("https://")) throw new DomainError("Use an https:// site URL so credentials stay encrypted in transit");
  return url.replace(/\/+$/, "");
};

/** Where published posts live on the brand's own site, e.g. https://example.com/blog. */
export const ownUrlPrefix = (v: string, site: { domain: string }) => {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    throw new DomainError("Use the public URL where posts appear, e.g. https://example.com/blog");
  }
  const own = site.domain.replace(/^www\./, "").toLowerCase();
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (u.protocol !== "https:" || (host !== own && !host.endsWith(`.${own}`))) throw new DomainError(`Use an https:// URL on your own site (${site.domain})`);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
};

export const URL_PREFIX = { key: "urlPrefix", label: "Public post URL prefix (optional)", required: false, parse: ownUrlPrefix, placeholder: "https://example.com/blog" } as const;
