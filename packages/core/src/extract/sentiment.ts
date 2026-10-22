/**
 * Lexicon sentiment per entity: each cue in a sentence is attributed to the
 * nearest entity mention in that sentence; negators within 3 words flip it.
 */
import { findAll, type Span } from "./text";

export type Sentiment = "positive" | "neutral" | "negative" | "mixed" | "unknown";

const POSITIVE = [
  "easy to use", "user-friendly", "industry standard", "best", "great", "excellent", "powerful", "robust", "reliable", "intuitive",
  "leading", "popular", "recommended", "top choice", "favorite", "trusted", "affordable", "fast", "flexible", "well-designed", "standout", "loved",
];
const NEGATIVE = [
  "steep learning curve", "expensive", "pricey", "overpriced", "limited", "lacking", "lacks", "slow", "buggy", "complicated", "complex",
  "outdated", "poor", "weak", "worse", "worst", "avoid", "difficult", "clunky", "unreliable", "frustrating", "drawbacks",
];
const NEGATORS = new Set(["not", "no", "never", "isn't", "aren't", "wasn't", "doesn't", "don't", "hardly", "without", "nor", "lacks"]);

export interface Cue extends Span {
  polarity: 1 | -1;
}

export function negated(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 40), at).toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean).slice(-3);
  return before.some((w) => NEGATORS.has(w));
}

/** Sentiment cues in a span of text (longest phrases first, no overlaps). */
export function cuesIn(text: string, span: Span): Cue[] {
  const slice = text.slice(span.start, span.end);
  const taken: Span[] = [];
  const cues: Cue[] = [];
  const lexicon = [...POSITIVE.map((p) => [p, 1] as const), ...NEGATIVE.map((n) => [n, -1] as const)].sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, pol] of lexicon) {
    for (const hit of findAll(slice, phrase)) {
      const abs = { start: span.start + hit.start, end: span.start + hit.end };
      if (taken.some((t) => abs.start < t.end && abs.end > t.start)) continue;
      // "lacks" is itself negative; do not double-negate it
      const flip = phrase !== "lacks" && negated(text, abs.start);
      taken.push(abs);
      cues.push({ ...abs, polarity: (flip ? -pol : pol) as 1 | -1 });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function combine(pos: number, neg: number): Sentiment {
  if (pos && neg) return "mixed";
  if (pos) return "positive";
  if (neg) return "negative";
  return "neutral";
}
