/** Text helpers shared by the extractors. */

export interface Span {
  start: number;
  end: number;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** Replace URLs with spaces (same length) so names inside links are not counted as mentions. */
export function maskUrls(text: string): string {
  return text.replace(URL_RE, (m) => " ".repeat(m.length));
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word (Unicode letters/digits as word chars), case-insensitive phrase matcher. */
export function phraseRegex(phrase: string): RegExp {
  const body = escapeRegex(phrase.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "giu");
}

export function findAll(text: string, phrase: string): Span[] {
  if (!phrase.trim()) return [];
  return [...text.matchAll(phraseRegex(phrase))].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

/** Merge overlapping spans, keeping the longest at each place. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** Sentence (or list line) boundaries as spans. */
export function sentences(text: string): Span[] {
  const out: Span[] = [];
  const re = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  for (const m of text.matchAll(re)) {
    if (m[0].trim()) out.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

export interface ListItem extends Span {
  index: number;
}

/** Numbered or bulleted list items (one per line). */
export function listItems(text: string): ListItem[] {
  const items: ListItem[] = [];
  const re = /^[ \t]*(?:\d{1,2}[.)]|[-*•])[ \t]+.+$/gm;
  for (const m of text.matchAll(re)) items.push({ start: m.index!, end: m.index! + m[0].length, index: items.length + 1 });
  return items;
}
