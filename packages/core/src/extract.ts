/**
 * Structured extraction pipeline: raw AI response text → mentions, citations,
 * position, sentiment, attribute observations, shopping cards.
 * Runs after each collected response (see packages/jobs).
 */
export interface ExtractedMention {
  name: string;
  competitorId: string | null;
  sentiment: "positive" | "neutral" | "negative" | "mixed" | "unknown";
  position: number | null;
}

export interface ExtractedCitation {
  url: string;
  domain: string;
  rank: number;
  isBrand: boolean;
}

export interface ExtractedShoppingCard {
  product?: string;
  price?: number;
  retailer?: string;
  rank?: number;
}

export interface ExtractionResult {
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  sentiment: "positive" | "neutral" | "negative" | "mixed" | "unknown";
  mentions: ExtractedMention[];
  citations: ExtractedCitation[];
  shoppingCard: ExtractedShoppingCard | null;
  /** attribute observations found in the text */
  observations: { attribute: string; textSpan: string; score: number; positive: boolean }[];
}

export interface ExtractionInput {
  rawText: string;
  brandName: string;
  brandDomain: string;
  competitors: { id: string; name: string; domain: string }[];
  attributes: string[];
  /** optional LLM-assisted extraction (structured JSON) merged over regex heuristics */
  structured?: Partial<ExtractionResult> | null;
}

const URL_RE = /https?:\/\/[^\s)\]>"']+/g;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function sentimentOf(text: string, name: string): ExtractionResult["sentiment"] {
  const span = mentionSpan(text, name);
  if (!span) return "unknown";
  const windowText = text.slice(Math.max(0, span.index - 120), span.index + span.length + 120).toLowerCase();
  const pos = ["best", "great", "excellent", "top choice", "recommended", "powerful", "leading", "robust", "loved"];
  const neg = ["worst", "poor", "expensive", "lacking", "weak", "limited", "outdated", "avoid", "overpriced"];
  const p = pos.filter((w) => windowText.includes(w)).length;
  const n = neg.filter((w) => windowText.includes(w)).length;
  if (p && n) return "mixed";
  if (p) return "positive";
  if (n) return "negative";
  return "neutral";
}

function mentionSpan(text: string, name: string): { index: number; length: number } | null {
  const idx = text.toLowerCase().indexOf(name.toLowerCase());
  if (idx === -1) return null;
  return { index: idx, length: name.length };
}

/**
 * Heuristic extractor. Uses regex/link parsing plus word-proximity sentiment.
 * When `structured` is provided (LLM JSON extraction), it takes precedence.
 */
export function extract(input: ExtractionInput): ExtractionResult {
  const { rawText, brandName, brandDomain, competitors, attributes } = input;

  // Citations: markdown links first, then bare URLs
  const seen = new Map<string, ExtractedCitation>();
  let rank = 0;
  for (const m of rawText.matchAll(MD_LINK_RE)) {
    const url = m[2];
    const domain = domainOf(url);
    if (!seen.has(url)) {
      seen.set(url, {
        url,
        domain,
        rank: rank++,
        isBrand: domain === brandDomain || domain.endsWith(`.${brandDomain}`),
      });
    }
  }
  for (const m of rawText.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;]+$/, "");
    if (!seen.has(url)) {
      const domain = domainOf(url);
      seen.set(url, {
        url,
        domain,
        rank: rank++,
        isBrand: domain === brandDomain || domain.endsWith(`.${brandDomain}`),
      });
    }
  }
  const citations = [...seen.values()];

  // Mentions: brand + competitors, with order → position
  const mentions: ExtractedMention[] = [];
  const brandSpan = mentionSpan(rawText, brandName);
  const mentioned = brandSpan !== null;
  if (mentioned) {
    mentions.push({
      name: brandName,
      competitorId: null,
      sentiment: sentimentOf(rawText, brandName),
      position: 1,
    });
  }
  const competitorHits: { id: string; name: string; index: number }[] = [];
  for (const c of competitors) {
    const span = mentionSpan(rawText, c.name);
    if (span) competitorHits.push({ id: c.id, name: c.name, index: span.index });
  }
  competitorHits.sort((a, b) => a.index - b.index);
  competitorHits.forEach((c) => {
    mentions.push({
      name: c.name,
      competitorId: c.id,
      sentiment: sentimentOf(rawText, c.name),
      position: null,
    });
  });

  // Brand position: rank of first brand mention among all entities by index
  let position: number | null = null;
  if (brandSpan) {
    const all = [brandSpan.index, ...competitorHits.map((c) => c.index)].sort((a, b) => a - b);
    position = all.indexOf(brandSpan.index) + 1;
  }

  // Attribute observations: attribute word near brand/competitor mention
  const observations: ExtractionResult["observations"] = [];
  for (const attr of attributes) {
    const attrIdx = rawText.toLowerCase().indexOf(attr.toLowerCase());
    if (attrIdx === -1) continue;
    const spanText = rawText.slice(Math.max(0, attrIdx - 80), attrIdx + attr.length + 80);
    const positive = !/not|never|lacks|weak|poor/i.test(spanText);
    observations.push({
      attribute: attr,
      textSpan: spanText.trim(),
      score: positive ? 0.8 : -0.8,
      positive,
    });
  }

  // Shopping card detection: "product – $price – retailer" patterns
  let shoppingCard: ExtractedShoppingCard | null = null;
  const priceMatch = rawText.match(/([\w\s'-]{3,40}?)\s*[–—-]\s*\$(\d+(?:\.\d{1,2})?)(?:\s*(?:at|from|on)\s*([\w.\-]+))?/i);
  if (priceMatch) {
    shoppingCard = {
      product: priceMatch[1]?.trim(),
      price: parseFloat(priceMatch[2]),
      retailer: priceMatch[3]?.replace(/^www\./, "") ?? undefined,
      rank: 1,
    };
  }

  const structured = input.structured;
  return {
    mentioned: structured?.mentioned ?? mentioned,
    cited: structured?.cited ?? citations.some((c) => c.isBrand),
    position: structured?.position ?? position,
    sentiment: structured?.sentiment ?? (mentioned ? mentions[0].sentiment : "unknown"),
    mentions: structured?.mentions ?? mentions,
    citations: structured?.citations ?? citations,
    shoppingCard: structured?.shoppingCard ?? shoppingCard,
    observations: structured?.observations ?? observations,
  };
}
