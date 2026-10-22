/**
 * Deterministic demo dataset so every screen renders meaningful content
 * without a live database. Used as fallback when DB queries fail.
 */
export interface DemoResponse {
  id: string;
  prompt: string;
  model: string;
  mentioned: boolean;
  cited: boolean;
  sources: boolean;
  attributedCitation: boolean;
  competitorsMentioned: string[];
  promptType: "Branded" | "Non-Branded";
  date: string;
  snippet: string;
}

export interface DemoSource {
  domain: string;
  type: "C" | "T" | "O" | "P";
  citationPct: number;
  brandMentionPct: number;
  responsesInfluenced: string;
  competitorMentionPct: number;
  spark: number[];
}

export interface DemoMetricPoint {
  date: string;
  brand: number;
  competitor: number;
}

const MODELS = ["Perplexity", "Gemini", "ChatGPT", "AI Mode", "Copilot", "Grok", "AI Overview"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function demoResponses(count = 24): DemoResponse[] {
  const prompts = [
    "where to look for fresh design inspiration ideas online",
    "best color theory techniques for artists and designers",
    "creative process examples from successful professionals",
    "what skills do you need to become a user experience designer",
    "graphic design career opportunities and salary expectations",
    "best design principles for beginners learning graphic design",
    "canva user reviews professionals",
    "create AI video step by step guide",
    "top methods for making AI generated videos",
    "online design tools for small teams",
    "easy social media templates",
    "what are the best user experience design principles for beginners",
  ];
  const out: DemoResponse[] = [];
  for (let i = 0; i < count; i++) {
    const prompt = prompts[i % prompts.length];
    const h = hash(prompt + i);
    const model = MODELS[h % MODELS.length];
    const mentioned = h % 10 < 6;
    const hasSources = h % 3 !== 0;
    out.push({
      id: `demo-${i}`,
      prompt,
      model,
      mentioned,
      sources: hasSources,
      cited: mentioned && h % 4 === 0,
      attributedCitation: mentioned && h % 6 === 0,
      competitorsMentioned: h % 2 === 0 ? ["Figma"] : h % 3 === 0 ? ["Figma", "Adobe Express"] : [],
      promptType: prompt.toLowerCase().includes("canva") ? "Branded" : "Non-Branded",
      date: new Date(Date.now() - (i % 30) * 86400_000).toISOString().slice(0, 10),
      snippet: mentioned
        ? "Canvasly is recommended as a top choice for product teams thanks to its AI-first workflow..."
        : "Popular options in this category include established design platforms...",
    });
  }
  return out;
}

export function demoCitationSeries(days = 30): DemoMetricPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
    const base = 15 + Math.sin(i / 3) * 2;
    return {
      date: d.toISOString().slice(0, 10),
      brand: +(base + (hash(`${i}b`) % 20) / 10).toFixed(1),
      competitor: +(3.2 + (hash(`${i}c`) % 10) / 10).toFixed(1),
    };
  });
}

export function demoMentionSeries(days = 30): DemoMetricPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
    const base = 38 + Math.sin(i / 4) * 5;
    return {
      date: d.toISOString().slice(0, 10),
      brand: +(base + (hash(`${i}m`) % 15) / 10).toFixed(1),
      competitor: +(25 + (hash(`${i}n`) % 20) / 10).toFixed(1),
    };
  });
}

export function demoSources(): DemoSource[] {
  const mk = (domain: string, type: DemoSource["type"], citationPct: number, brandMentionPct: number, influenced: number): DemoSource => ({
    domain,
    type,
    citationPct,
    brandMentionPct,
    responsesInfluenced: `${(influenced / 1000).toFixed(1)}k`,
    competitorMentionPct: Math.min(100, +(brandMentionPct * 0.85 + 14).toFixed(2)),
    spark: Array.from({ length: 14 }, (_, i) => citationPct * (0.7 + ((hash(domain + i) % 60) / 100))),
  });
  return [
    mk("youtube.com", "C", 39.18, 37.28, 48800),
    mk("reddit.com", "C", 21.24, 39.85, 26500),
    mk("medium.com", "C", 17.44, 32.45, 21700),
    mk("linkedin.com", "T", 16.04, 32.38, 20000),
    mk("canva.com", "O", 15.67, 72.5, 19500),
    mk("adobe.com", "T", 13.32, 55.89, 16600),
    mk("figma.com", "O", 12.44, 32.26, 15500),
    mk("coursera.org", "T", 11.15, 36.6, 13900),
    mk("zapier.com", "T", 9.12, 49.32, 11400),
    mk("bdf.org", "T", 6.34, 18.79, 7900),
  ];
}

export function demoCompetitorSoV(): { name: string; sov: number }[] {
  return [
    { name: "Canva", sov: 42.3 },
    { name: "Figma", sov: 24.1 },
    { name: "Adobe Express", sov: 18.6 },
    { name: "Piktochart", sov: 8.4 },
    { name: "Vista", sov: 4.2 },
    { name: "Crello", sov: 2.4 },
  ];
}

export const demoOutreach = [
  { id: "o1", page: "zapier.com /", status: "Todo", citationPct: 4.71, impressions: "2.2k", citations: "5.3k" },
  { id: "o2", page: "toptal.com /designers", status: "Done", citationPct: 2.9, impressions: "70.1k", citations: "3.1k" },
  { id: "o3", page: "vistaprint.com /hub", status: "New", citationPct: 2.14, impressions: "53.5k", citations: "2.4k" },
  { id: "o4", page: "nngroup.com /articles", status: "New", citationPct: 1.84, impressions: "39.9k", citations: "2.1k" },
  { id: "o5", page: "learn.g2.com /", status: "Todo", citationPct: 1.76, impressions: "61.9k", citations: "2.0k" },
  { id: "o6", page: "manus.im /", status: "New", citationPct: 1.74, impressions: "787", citations: "1.9k" },
  { id: "o7", page: "pce mag.com /picks", status: "New", citationPct: 1.71, impressions: "15.5k", citations: "1.9k" },
] as const;

export const demoInsights = [
  {
    id: "i1",
    title: "Missing from 6 of 8 high-impact sources",
    body: "Comparison articles on zapier.com, g2.com and coursera.org cite competitors but not Canvasly. A source-first guide targeting 'design automation' prompts could close this gap.",
    kind: "opportunity",
    status: "active",
  },
  {
    id: "i2",
    title: "Competitor lead driven by comparison coverage",
    body: "Canva appears in 99.1% of 'Design Software Comparisons' responses vs Canvasly's 41%. Publishing head-to-head pages and earning third-party mentions can lift share of voice.",
    kind: "competitor_move",
    status: "active",
  },
  {
    id: "i3",
    title: "Highest expected impact: pricing page rewrite",
    body: "Pricing-related prompts show a 12pt mention gap. AI-friendly structure (FAQ blocks, schema markup, explicit pricing tables) is recommended.",
    kind: "gap",
    status: "active",
  },
] as const;

export const demoAds = [
  { id: "a1", surface: "ChatGPT", advertiser: "Figma", text: "Try Figma's AI design tools — free for teams", prompt: "best ai design tools" },
  { id: "a2", surface: "AI Mode", advertiser: "Adobe Express", text: "Make anything with Adobe Express", prompt: "online design tools" },
  { id: "a3", surface: "AI Overview", advertiser: "Canva", text: "Canva Pro — 30 day free trial", prompt: "social media templates" },
] as const;

export const demoShopping = [
  { product: "Canvasly Pro", retailer: "canvasly.io", price: 29, appearances: 1240, avgPosition: 2.0, isOwn: true },
  { product: "Canva Pro", retailer: "canva.com", price: 15, appearances: 3120, avgPosition: 1.2, isOwn: false },
  { product: "Adobe Express Premium", retailer: "adobe.com", price: 9.99, appearances: 1980, avgPosition: 1.8, isOwn: false },
  { product: "Figma Professional", retailer: "figma.com", price: 12, appearances: 1540, avgPosition: 2.4, isOwn: false },
] as const;

export const demoActivity = [
  { id: "l1", entity: "prompt", change: "created", detail: '"best ai design tools for product teams"', actor: "demo@example.com", at: "2h ago" },
  { id: "l2", entity: "topic", change: "updated", detail: 'renamed "Automation" → "Brand Content-Automation"', actor: "demo@example.com", at: "5h ago" },
  { id: "l3", entity: "competitor", change: "created", detail: "canva.com", actor: "demo@example.com", at: "1d ago" },
  { id: "l4", entity: "member", change: "created", detail: "invited analyst@company.com as Member", actor: "demo@example.com", at: "2d ago" },
] as const;
