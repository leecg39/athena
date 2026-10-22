import type { EntityComparison } from "@athena/core/competitors";

function SentimentBar({ s }: { s: EntityComparison["sentiment"] }) {
  const total = s.positive + s.neutral + s.negative + s.mixed;
  if (!total) return <span className="text-xs text-gray-300">—</span>;
  const width = (n: number) => ({ width: `${(n / total) * 100}%` });
  return (
    <div className="flex h-2 w-40 overflow-hidden rounded-full bg-gray-100" title={`+${s.positive} · ~${s.neutral} · ±${s.mixed} · −${s.negative}`}>
      <span className="bg-emerald-500" style={width(s.positive)} />
      <span className="bg-gray-300" style={width(s.neutral)} />
      <span className="bg-amber-400" style={width(s.mixed)} />
      <span className="bg-red-500" style={width(s.negative)} />
    </div>
  );
}

export function ComparisonTable({ entities }: { entities: EntityComparison[] }) {
  return (
    <section className="rounded-xl border border-gray-100 p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">AI visibility comparison</h2>
      <table className="table-base">
        <thead>
          <tr>
            <th>Brand</th>
            <th>Mention rate</th>
            <th>Share of voice</th>
            <th>Avg position</th>
            <th>Citation rate</th>
            <th>Sentiment (answers)</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e.competitorId ?? "brand"} className={e.competitorId === null ? "bg-brand-50/40" : ""}>
              <td className={e.competitorId === null ? "font-semibold text-brand-700" : ""}>
                {e.name} <span className="text-xs text-gray-400">{e.domain}</span>
              </td>
              <td>{e.mentionRate}%</td>
              <td>{e.shareOfVoice}%</td>
              <td>{e.avgPosition === null ? "—" : `#${e.avgPosition}`}</td>
              <td>{e.citationRate}%</td>
              <td>
                <SentimentBar s={e.sentiment} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
