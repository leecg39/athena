/**
 * The Markdown subset drafts are written in, parsed once into a tree that each
 * CMS format (HTML, Portable Text, Contentful Rich Text, Lexical) renders from.
 * Links are kept only for http(s) URLs and site-relative paths.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] };

export type Mark = "strong" | "em" | "code";
/** A stretch of text with one format: what rich-text formats store per text node. */
export interface Run {
  text: string;
  marks: Mark[];
  href: string | null;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;
const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+/;
const HEADING = /^(#{1,6})\s+/;
const FENCE = /^\s*```/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export const safeHref = (url: string) => (/^https?:\/\/[^\s]+$/i.test(url) || /^\/(?!\/)[^\s]*$/.test(url) ? url : null);

function token(m: RegExpMatchArray): Inline {
  const t = m[0];
  if (m[1]) return { type: "code", value: t.slice(1, -1) };
  if (m[2]) return { type: "strong", children: parseInline(t.slice(2, -2)) };
  if (m[3]) {
    const label = t.slice(1, t.indexOf("]("));
    const url = t.slice(t.indexOf("](") + 2, -1);
    const href = safeHref(url);
    return href ? { type: "link", href, children: parseInline(label) } : { type: "text", value: `${label} (${url})` };
  }
  return { type: "em", children: parseInline(t.slice(1, -1)) };
}

export function parseInline(text: string): Inline[] {
  const matches = [...text.matchAll(INLINE)];
  const pieces = matches.flatMap((m, i) => {
    const from = i === 0 ? 0 : (matches[i - 1].index ?? 0) + matches[i - 1][0].length;
    const before = text.slice(from, m.index ?? 0);
    return [...(before ? [{ type: "text" as const, value: before }] : []), token(m)];
  });
  const last = matches.at(-1);
  const rest = text.slice(last ? (last.index ?? 0) + last[0].length : 0);
  return rest ? [...pieces, { type: "text", value: rest }] : pieces;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => parseInline(c.trim()));
const isStart = (l: string, next = "") => FENCE.test(l) || HEADING.test(l) || BULLET.test(l) || NUMBERED.test(l) || l.trim().startsWith(">") || (l.trim().startsWith("|") && TABLE_SEP.test(next));
const until = (lines: string[], from: number, keep: (l: string, i: number) => boolean) => {
  const at = lines.findIndex((l, i) => i >= from && !keep(l, i));
  return at === -1 ? lines.length : at;
};

/** The block starting at line i (null for a blank line) and the index of the next line to read. */
function block(lines: string[], i: number): [Block | null, number] {
  const line = lines[i];
  if (!line.trim()) return [null, i + 1];
  if (FENCE.test(line)) {
    const end = until(lines, i + 1, (l) => !FENCE.test(l));
    return [{ type: "code", value: lines.slice(i + 1, end).join("\n") }, end + 1];
  }
  const h = HEADING.exec(line);
  if (h) return [{ type: "heading", level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(line.replace(HEADING, "")) }, i + 1];
  if (BULLET.test(line) || NUMBERED.test(line)) {
    const re = BULLET.test(line) ? BULLET : NUMBERED;
    const end = until(lines, i, (l) => re.test(l));
    return [{ type: "list", ordered: re === NUMBERED, items: lines.slice(i, end).map((l) => parseInline(l.replace(re, ""))) }, end];
  }
  if (line.trim().startsWith("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
    const end = until(lines, i + 2, (l) => l.trim().startsWith("|"));
    return [{ type: "table", head: cells(line), rows: lines.slice(i + 2, end).map(cells) }, end];
  }
  if (line.trim().startsWith(">")) {
    const end = until(lines, i, (l) => l.trim().startsWith(">"));
    return [{ type: "quote", children: parseInline(lines.slice(i, end).map((l) => l.trim().replace(/^>\s?/, "")).join(" ")) }, end];
  }
  const end = until(lines, i + 1, (l, j) => Boolean(l.trim()) && !isStart(l, lines[j + 1]));
  return [{ type: "paragraph", children: parseInline(lines.slice(i, end).join(" ")) }, end];
}

function* blockStream(lines: string[]): Generator<Block> {
  let at = 0;
  while (at < lines.length) {
    const [b, next] = block(lines, at);
    if (b) yield b;
    at = next;
  }
}

export function parseMarkdown(markdown: string): Block[] {
  return [...blockStream(markdown.split(/\r?\n/))];
}

const sameFormat = (a: Run, b: Run) => a.href === b.href && a.marks.length === b.marks.length && a.marks.every((m, i) => m === b.marks[i]);

function runsOf(nodes: Inline[], marks: Mark[], href: string | null): Run[] {
  return nodes.flatMap((n): Run[] => {
    if (n.type === "text") return n.value ? [{ text: n.value, marks, href }] : [];
    if (n.type === "code") return [{ text: n.value, marks: [...marks, "code"], href }];
    if (n.type === "link") return runsOf(n.children, marks, n.href);
    return runsOf(n.children, marks.includes(n.type) ? marks : [...marks, n.type], href);
  });
}

/** Inline content as formatted runs; neighbours with the same format are merged. */
export function inlineRuns(nodes: Inline[]): Run[] {
  return runsOf(nodes, [], null).reduce<Run[]>((acc, r) => {
    const prev = acc.at(-1);
    return prev && sameFormat(prev, r) ? [...acc.slice(0, -1), { ...prev, text: prev.text + r.text }] : [...acc, r];
  }, []);
}
