/**
 * Metric engine: mention rate, citation rate, share of voice, average position.
 * Pure functions over response rows — used by the aggregation job and dashboards.
 * Mirrors the observed API contract: cumulative + over-time series, with
 * relative_mention_rate (share of responses mentioning ≥1 tracked brand).
 */
export interface MetricResponse {
  id: string;
  ranAt: Date;
  model: string;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  /** competitor ids mentioned in this response */
  competitorMentions: string[];
}

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
}

export interface MentionPoint extends SeriesPoint {
  mentionRate: number; // absolute: % of all responses
  relativeMentionRate: number; // % of responses mentioning ≥1 tracked brand
}

export interface BrandPoint extends SeriesPoint {
  brand: number; // percentage
  competitors: Record<string, number>;
}

export interface PositionPoint extends SeriesPoint {
  position: number | null; // average position (lower is better)
}

export interface CumulativeResult {
  totalResponses: number;
  mentionRatePct: number;
  relativeMentionRatePct: number;
  citationRatePct: number;
  avgPosition: number | null;
  shareOfVoicePct: number;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function cumulative(
  rows: MetricResponse[],
  competitorTotals?: Record<string, number>,
): CumulativeResult {
  const total = rows.length;
  const mentioned = rows.filter((r) => r.mentioned).length;
  const cited = rows.filter((r) => r.cited).length;
  const positions = rows.map((r) => r.position).filter((p): p is number => p !== null);
  const brandMentions = mentioned;
  const competitorMentions = Object.values(competitorTotals ?? {}).reduce((a, b) => a + b, 0);
  const denom = brandMentions + competitorMentions;
  return {
    totalResponses: total,
    mentionRatePct: total ? (mentioned / total) * 100 : 0,
    relativeMentionRatePct:
      total && brandMentions + competitorMentions > 0
        ? (brandMentions / (rows.filter((r) => r.mentioned || r.competitorMentions.length > 0).length || 1)) * 100
        : 0,
    citationRatePct: total ? (cited / total) * 100 : 0,
    avgPosition: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
    shareOfVoicePct: denom ? (brandMentions / denom) * 100 : 0,
  };
}

/** Daily mention rate + relative mention rate. */
export function mentionRateOverTime(rows: MetricResponse[]): MentionPoint[] {
  const byDay = new Map<string, MetricResponse[]>();
  for (const r of rows) {
    const k = dayKey(r.ranAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, dayRows]) => {
      const withAny = dayRows.filter((r) => r.mentioned || r.competitorMentions.length > 0).length;
      return {
        date,
        mentionRate: pct(dayRows.filter((r) => r.mentioned).length, dayRows.length),
        relativeMentionRate: pct(dayRows.filter((r) => r.mentioned).length, withAny),
      };
    });
}

/** Daily share of voice: brand vs each competitor over responses mentioning ≥1 tracked brand. */
export function shareOfVoiceOverTime(
  rows: MetricResponse[],
  competitorNames: Record<string, string>,
): BrandPoint[] {
  const byDay = new Map<string, MetricResponse[]>();
  for (const r of rows) {
    const k = dayKey(r.ranAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, dayRows]) => {
      const brandHits = dayRows.filter((r) => r.mentioned).length;
      const compHits: Record<string, number> = {};
      for (const r of dayRows) {
        for (const cid of r.competitorMentions) compHits[cid] = (compHits[cid] ?? 0) + 1;
      }
      const denom = brandHits + Object.values(compHits).reduce((a, b) => a + b, 0);
      const competitors: Record<string, number> = {};
      for (const [cid, hits] of Object.entries(compHits)) {
        competitors[competitorNames[cid] ?? cid] = denom ? (hits / denom) * 100 : 0;
      }
      return { date, brand: denom ? (brandHits / denom) * 100 : 0, competitors };
    });
}

/** Daily citation rate for brand + competitors (brand citations only tracked here). */
export function citationRateOverTime(rows: MetricResponse[]): BrandPoint[] {
  const byDay = new Map<string, MetricResponse[]>();
  for (const r of rows) {
    const k = dayKey(r.ranAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, dayRows]) => ({
      date,
      brand: pct(dayRows.filter((r) => r.cited).length, dayRows.length),
      competitors: {},
    }));
}

/** Daily average position (lower is better; null when not mentioned). */
export function positionOverTime(rows: MetricResponse[]): PositionPoint[] {
  const byDay = new Map<string, MetricResponse[]>();
  for (const r of rows) {
    const k = dayKey(r.ranAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, dayRows]) => {
      const positions = dayRows.map((r) => r.position).filter((p): p is number => p !== null);
      return {
        date,
        position: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
      };
    });
}

/**
 * Estimated business value of AI search presence (AI Search Value).
 * Model: responses influenced × estimated AI-referral value per response.
 */
export function aiSearchValue(opts: {
  responsesInfluenced: number;
  valuePerResponseUsd?: number;
}): number {
  const v = opts.valuePerResponseUsd ?? 0.86;
  return Math.round(opts.responsesInfluenced * v * 100) / 100;
}

function pct(n: number, d: number): number {
  return d ? (n / d) * 100 : 0;
}
