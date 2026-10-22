/**
 * Structured extraction: raw AI answer → brand/competitor mentions (whole-word),
 * list position, per-entity sentiment, attribute observations, citations, shopping card.
 */
import { aliasesFor, findMentions } from "./entities";
import { extractCitations, type ExtractedCitation } from "./citations";
import { combine, cuesIn, negated, type Sentiment } from "./sentiment";
import { detectShoppingCard, type ShoppingCard } from "./shopping";
import { findAll, listItems, maskUrls, sentences, type Span } from "./text";

export { findMentions, aliasesFor } from "./entities";
export { extractCitations, domainOf, isBrandDomain, type ExtractedCitation } from "./citations";
export { detectShoppingCard, type ShoppingCard } from "./shopping";
export type { Sentiment } from "./sentiment";
export { lockExtractedData } from "./lock";

export interface ExtractedMention {
  name: string;
  competitorId: string | null;
  sentiment: Sentiment;
  position: number | null;
}

export interface AttributeObservation {
  attribute: string;
  /** null = the brand */
  competitorId: string | null;
  textSpan: string;
  score: number;
  positive: boolean;
}

export interface ExtractionResult {
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  sentiment: Sentiment;
  mentions: ExtractedMention[];
  citations: ExtractedCitation[];
  shoppingCard: ShoppingCard | null;
  observations: AttributeObservation[];
}

export interface ExtractionInput {
  rawText: string;
  brandName: string;
  brandDomain: string;
  competitors: { id: string; name: string; domain: string }[];
  attributes: string[];
}

interface EntityHits {
  name: string;
  competitorId: string | null;
  spans: Span[];
}

const within = (s: Span, outer: Span) => s.start >= outer.start && s.start < outer.end;

export function extract(input: ExtractionInput): ExtractionResult {
  const text = input.rawText;
  const entities: EntityHits[] = [
    { name: input.brandName, competitorId: null, spans: findMentions(text, aliasesFor(input.brandName, input.brandDomain)) },
    ...input.competitors.map((c) => ({ name: c.name, competitorId: c.id, spans: findMentions(text, aliasesFor(c.name, c.domain)) })),
  ];
  const present = entities.filter((e) => e.spans.length);

  // position: list rank when the answer is a list, else order of first mention
  const items = listItems(text);
  const byOrder = [...present].sort((a, b) => a.spans[0].start - b.spans[0].start);
  const positionOf = (e: EntityHits): number | null => {
    if (!e.spans.length) return null;
    if (items.length >= 2) {
      const item = items.find((it) => e.spans.some((s) => within(s, it)));
      if (item) return item.index;
    }
    return byOrder.indexOf(e) + 1;
  };

  // per-entity sentiment: cues go to the nearest mention in the same sentence
  const score = new Map<EntityHits, { pos: number; neg: number }>(present.map((e) => [e, { pos: 0, neg: 0 }]));
  const sents = sentences(text);
  for (const sent of sents) {
    const local = present.flatMap((e) => e.spans.filter((s) => within(s, sent)).map((s) => ({ e, s })));
    if (!local.length) continue;
    for (const cue of cuesIn(text, sent)) {
      const nearest = local.reduce((best, cur) => (Math.abs(cur.s.start - cue.start) < Math.abs(best.s.start - cue.start) ? cur : best));
      const sc = score.get(nearest.e)!;
      if (cue.polarity > 0) sc.pos++;
      else sc.neg++;
    }
  }
  const sentimentOf = (e: EntityHits): Sentiment => {
    const sc = score.get(e);
    return sc ? combine(sc.pos, sc.neg) : "unknown";
  };

  // attribute observations attributed to the nearest entity in the sentence
  const masked = maskUrls(text);
  const observations: (AttributeObservation & { at: number })[] = [];
  for (const attr of input.attributes) {
    for (const hit of findAll(masked, attr)) {
      const sent = sents.find((s) => within(hit, s));
      if (!sent) continue;
      const local = present.flatMap((e) => e.spans.filter((s) => within(s, sent)).map((s) => ({ e, s })));
      if (!local.length) continue;
      const nearest = local.reduce((best, cur) => (Math.abs(cur.s.start - hit.start) < Math.abs(best.s.start - hit.start) ? cur : best));
      const positive = !negated(text, hit.start);
      observations.push({
        attribute: attr,
        competitorId: nearest.e.competitorId,
        textSpan: text.slice(sent.start, sent.end).trim().slice(0, 300),
        score: positive ? 0.8 : -0.8,
        positive,
        at: hit.start,
      });
    }
  }

  const brand = entities[0];
  const competitorMentions = byOrder.filter((e) => e.competitorId !== null);
  const citations = extractCitations(text, input.brandDomain);
  return {
    mentioned: brand.spans.length > 0,
    cited: citations.some((c) => c.isBrand),
    position: positionOf(brand),
    sentiment: brand.spans.length ? sentimentOf(brand) : "unknown",
    mentions: [...(brand.spans.length ? [brand] : []), ...competitorMentions].map((e) => ({
      name: e.name,
      competitorId: e.competitorId,
      sentiment: sentimentOf(e),
      position: positionOf(e),
    })),
    citations,
    shoppingCard: detectShoppingCard(text),
    observations: observations.sort((a, b) => a.at - b.at).map(({ at: _at, ...o }) => o),
  };
}

export interface HighlightSegment {
  text: string;
  /** key of the entity this segment names; absent for plain text */
  entity?: string;
}

/** Split answer text into plain and entity-mention segments (for safe React rendering). */
export function highlightSegments(text: string, entities: { key: string; aliases: string[] }[]): HighlightSegment[] {
  const hits = entities
    .flatMap((e) => findMentions(text, e.aliases).map((s) => ({ ...s, key: e.key })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue; // overlapping hit already covered
    if (h.start > cursor) segments.push({ text: text.slice(cursor, h.start) });
    segments.push({ text: text.slice(h.start, h.end), entity: h.key });
    cursor = h.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
