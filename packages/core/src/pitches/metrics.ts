/**
 * Pitch measurements from AI answers collected for the prospect, using the
 * same extraction as tracked websites (mentions, list position, citations).
 */
import { z } from "zod";
import { extract, domainOf, isBrandDomain } from "../extract";

/** One answer as returned by a search adapter (structurally compatible with @athena/llm). */
export interface CollectedPitchAnswer {
  prompt: string;
  model: string;
  text: string;
  citations: { url: string; domain?: string }[];
  provider: string;
  simulated?: boolean;
}

export interface PitchAnswer {
  prompt: string;
  model: string;
  provider: string;
  simulated: boolean;
  mentioned: boolean;
  position: number | null;
  cited: boolean;
  competitorsMentioned: string[];
  citedDomains: string[];
  excerpt: string;
}

export interface PitchRewrite {
  targetPageUrl: string | null;
  focusPrompt: string | null;
  beforeCopy: string;
  afterCopy: string;
  faq: { question: string; answer: string }[];
  writtenBy: string;
  writtenAt: string;
}

export interface PitchPayload {
  version: 2;
  domain: string;
  websiteUrl: string;
  industry: string | null;
  collectedAt: string;
  prompts: string[];
  competitors: string[];
  models: string[];
  totals: { answers: number; mentionRatePct: number; citationRatePct: number; shareOfVoicePct: number; avgPosition: number | null; simulatedSharePct: number };
  competitorSov: { name: string; isOwn: boolean; mentions: number; sovPct: number }[];
  topSources: { domain: string; citations: number; isOwn: boolean }[];
  byModel: { model: string; answers: number; mentionRatePct: number; citationRatePct: number }[];
  answers: PitchAnswer[];
  /** prompt × model pairs that could not be collected (their credits were refunded) */
  failures: { prompt: string; model: string }[];
  rewrite: PitchRewrite | null;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const countBy = <T>(items: T[], key: (t: T) => string) => items.reduce((m, t) => new Map(m).set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>());

function analyse(a: CollectedPitchAnswer, brandName: string, domain: string, competitors: string[]): PitchAnswer {
  const ex = extract({ rawText: a.text, brandName, brandDomain: domain, competitors: competitors.map((name, i) => ({ id: `c${i}`, name, domain: "" })), attributes: [] });
  const sourceDomains = a.citations.map((c) => (c.domain ?? domainOf(c.url)).toLowerCase());
  const citedDomains = [...new Set([...sourceDomains, ...ex.citations.map((c) => c.domain)])].filter(Boolean).slice(0, 20);
  return {
    prompt: a.prompt,
    model: a.model,
    provider: a.provider,
    simulated: Boolean(a.simulated),
    mentioned: ex.mentioned,
    position: ex.position,
    cited: ex.cited || citedDomains.some((d) => isBrandDomain(d, domain)),
    competitorsMentioned: ex.mentions.filter((m) => m.competitorId !== null).map((m) => m.name),
    citedDomains,
    excerpt: a.text.replace(/\s+/g, " ").trim().slice(0, 400),
  };
}

function shares(answers: PitchAnswer[], brandName: string, competitors: string[]) {
  const counts = [{ name: brandName, isOwn: true, mentions: answers.filter((a) => a.mentioned).length }, ...competitors.map((name) => ({ name, isOwn: false, mentions: answers.filter((a) => a.competitorsMentioned.includes(name)).length }))];
  const total = counts.reduce((s, c) => s + c.mentions, 0);
  return { total, list: total ? counts.map((c) => ({ ...c, sovPct: pct(c.mentions, total) })).sort((a, b) => b.sovPct - a.sovPct) : [] };
}

export function computePitchPayload(input: {
  answers: CollectedPitchAnswer[];
  failures: { prompt: string; model: string }[];
  brandName: string;
  domain: string;
  websiteUrl: string;
  industry: string | null;
  prompts: string[];
  competitors: string[];
  collectedAt: Date;
}): PitchPayload {
  const answers = input.answers.map((a) => analyse(a, input.brandName, input.domain, input.competitors));
  const n = answers.length;
  const positions = answers.map((a) => a.position).filter((p): p is number => p !== null);
  const sov = shares(answers, input.brandName, input.competitors);
  const sources = countBy(answers.flatMap((a) => a.citedDomains), (d) => d);
  const models = [...new Set(answers.map((a) => a.model))];
  return {
    version: 2,
    domain: input.domain,
    websiteUrl: input.websiteUrl,
    industry: input.industry,
    collectedAt: input.collectedAt.toISOString(),
    prompts: input.prompts,
    competitors: input.competitors,
    models,
    totals: {
      answers: n,
      mentionRatePct: pct(answers.filter((a) => a.mentioned).length, n),
      citationRatePct: pct(answers.filter((a) => a.cited).length, n),
      shareOfVoicePct: sov.list.find((c) => c.isOwn)?.sovPct ?? 0,
      avgPosition: positions.length ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10 : null,
      simulatedSharePct: pct(answers.filter((a) => a.simulated).length, n),
    },
    competitorSov: sov.list,
    topSources: [...sources.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([d, c]) => ({ domain: d, citations: c, isOwn: isBrandDomain(d, input.domain) })),
    byModel: models.map((m) => {
      const own = answers.filter((a) => a.model === m);
      return { model: m, answers: own.length, mentionRatePct: pct(own.filter((a) => a.mentioned).length, own.length), citationRatePct: pct(own.filter((a) => a.cited).length, own.length) };
    }),
    answers,
    failures: input.failures,
    rewrite: null,
  };
}

/** Pitches stored by earlier versions held invented numbers; only measured (v2) payloads are used. */
export function parsePitchPayload(raw: unknown): PitchPayload | null {
  const ok = z.object({ version: z.literal(2), totals: z.object({ answers: z.number() }), answers: z.array(z.unknown()) }).passthrough().safeParse(raw);
  return ok.success ? (raw as PitchPayload) : null;
}
