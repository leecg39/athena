import { decodeEntities } from "../shared/html";

/**
 * Author contact exactly as a page publishes it: Article JSON-LD, author meta
 * tags or a rel="author" byline. Never guesses — no match gives nulls, and an
 * email is only returned when the page itself publishes it for the author.
 */

export interface FoundAuthor {
  authorName: string | null;
  authorEmail: string | null;
  source: "json-ld" | "meta" | "byline" | null;
}

const NONE: FoundAuthor = { authorName: null, authorEmail: null, source: null };
/** author markup lives near the top; bounding the input keeps every scan linear and cheap */
const MAX_HTML = 600_000;
const ARTICLE_TYPE = /^(Article|NewsArticle|AnalysisNewsArticle|OpinionNewsArticle|ReportageNewsArticle|BlogPosting|TechArticle|ScholarlyArticle|Report|Review|WebPage)$/;
const META_NAMES = new Set(["author", "byl", "parsely-author", "sailthru.author", "dc.creator", "article:author"]);
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = decodeEntities(raw.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().replace(/^by\s+/i, "");
  if (!name || name.length > 100 || /^https?:\/\//i.test(name) || /[<>{}]/.test(name)) return null;
  return name;
}

function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().replace(/^mailto:/i, "").split("?")[0];
  return EMAIL.test(email) ? email.toLowerCase() : null;
}

/** name="value" / name='value' / name=value pairs of one tag's attribute string */
function attributes(attrs: string): Map<string, string> {
  return new Map([...attrs.matchAll(/([a-z][a-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]));
}

function jsonLdNodes(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((v) => jsonLdNodes(v, depth + 1));
  const node = value as Record<string, unknown>;
  return [node, ...jsonLdNodes(node["@graph"], depth + 1)];
}

const isArticle = (node: Record<string, unknown>) => [node["@type"]].flat().some((t) => typeof t === "string" && ARTICLE_TYPE.test(t));

function fromJsonLd(html: string): FoundAuthor | null {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => /type\s*=\s*["']?application\/ld\+json/i.test(m[1]))
    .flatMap((m) => {
      try {
        return [JSON.parse(m[2]) as unknown];
      } catch {
        return [];
      }
    });
  for (const node of blocks.flatMap((b) => jsonLdNodes(b)).filter(isArticle)) {
    for (const a of [node.author].flat()) {
      const person = a !== null && typeof a === "object" ? (a as Record<string, unknown>) : null;
      const name = cleanName(person ? person.name : a);
      if (name) return { authorName: name, authorEmail: person ? cleanEmail(person.email) : null, source: "json-ld" };
    }
  }
  return null;
}

function fromMeta(html: string): FoundAuthor | null {
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = attributes(m[1]);
    const key = (attrs.get("name") ?? attrs.get("property") ?? "").toLowerCase();
    const name = META_NAMES.has(key) ? cleanName(attrs.get("content")) : null;
    if (name) return { authorName: name, authorEmail: null, source: "meta" };
  }
  return null;
}

function fromByline(html: string): FoundAuthor | null {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\bauthor\b/i.test(attributes(m[1]).get("rel") ?? "")) continue;
    const name = cleanName(m[2].slice(0, 300));
    if (name) return { authorName: name, authorEmail: null, source: "byline" };
  }
  return null;
}

export function authorFromHtml(html: string): FoundAuthor {
  const page = html.slice(0, MAX_HTML);
  return fromJsonLd(page) ?? fromMeta(page) ?? fromByline(page) ?? NONE;
}
