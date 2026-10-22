import type { CardId, SearchValue, TotalsDelta, VisibilityTotals } from "@athena/core/analytics";

function Delta({ value, unit, invert }: { value: number | null | undefined; unit: string; invert?: boolean }) {
  if (value === null || value === undefined) return <span className="text-[11px] text-gray-300">no prior data</span>;
  if (value === 0) return <span className="text-[11px] text-gray-400">±0{unit} vs previous</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={`text-[11px] ${good ? "text-emerald-600" : "text-red-600"}`}>
      {value > 0 ? "+" : ""}
      {value}
      {unit} vs previous period
    </span>
  );
}

function Tile({ label, value, help, children }: { label: string; value: string; help: string; children?: React.ReactNode }) {
  return (
    <div className="metric-card" title={help}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function MetricCards({
  cards,
  totals,
  delta,
  value,
}: {
  cards: CardId[];
  totals: VisibilityTotals;
  delta: TotalsDelta | null;
  value: SearchValue;
}) {
  const show = cards.length ? cards : (["mention", "citation", "sov", "position", "value"] as CardId[]);
  const tiles: Record<CardId, React.ReactNode> = {
    mention: (
      <Tile key="mention" label="Mention rate" value={`${totals.mentionRate}%`} help="Share of AI answers that mention your brand">
        <Delta value={delta?.mentionRate} unit="pt" />
      </Tile>
    ),
    citation: (
      <Tile key="citation" label="Citation rate" value={`${totals.citationRate}%`} help="Share of AI answers that cite your own domain as a source">
        <Delta value={delta?.citationRate} unit="pt" />
      </Tile>
    ),
    sov: (
      <Tile key="sov" label="Share of voice" value={`${totals.shareOfVoice}%`} help="Your brand's share of all tracked-brand mentions">
        <Delta value={delta?.shareOfVoice} unit="pt" />
      </Tile>
    ),
    position: (
      <Tile key="position" label="Avg position" value={totals.avgPosition === null ? "—" : `#${totals.avgPosition}`} help="Average rank when mentioned (lower is better)">
        <Delta value={delta?.avgPosition} unit="" invert />
      </Tile>
    ),
    value: (
      <Tile
        key="value"
        label="AI search value"
        value={value.hasVolume ? value.aiVisibleSearches.toLocaleString() : "—"}
        help="Estimated searches where AI answers mention you: Σ prompt search volume × mention rate"
      >
        <span className="text-[11px] text-gray-400">
          {value.hasVolume ? `AI-visible searches of ${value.trackedVolume.toLocaleString()} tracked` : "Needs search volume (connect Search Console)"}
        </span>
      </Tile>
    ),
  };
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{show.map((c) => tiles[c])}</div>;
}
