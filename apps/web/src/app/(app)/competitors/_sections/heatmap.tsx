import Link from "next/link";
import type { Heatmap } from "@athena/core/competitors";

export type HeatmapMetric = "mention" | "citation";

/** Cell background: brand-tinted intensity proportional to the percentage. */
function heat(value: number): React.CSSProperties {
  const a = Math.min(1, value / 100);
  return { background: `rgba(79, 57, 246, ${(0.06 + a * 0.6).toFixed(2)})`, color: a > 0.55 ? "#fff" : "#1f2937" };
}

function MetricTabs({ metric, hrefFor }: { metric: HeatmapMetric; hrefFor: (m: HeatmapMetric) => string }) {
  const tab = (m: HeatmapMetric, label: string) => (
    <Link role="tab" aria-selected={metric === m} href={hrefFor(m)} className={`rounded-lg px-3 py-1 ${metric === m ? "bg-brand-50 font-medium text-brand-600" : "text-gray-500"}`}>
      {label}
    </Link>
  );
  return (
    <div className="flex gap-1 text-xs" role="tablist" aria-label="Heatmap metric">
      {tab("mention", "Mention rate")}
      {tab("citation", "Citation rate")}
    </div>
  );
}

function HeatmapTable({ heatmap, grid }: { heatmap: Heatmap; grid: number[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-gray-500">Topic</th>
            {heatmap.entities.map((e) => (
              <th key={e.competitorId ?? "brand"} className={`px-2 py-1 font-medium ${e.competitorId === null ? "text-brand-700" : "text-gray-500"}`}>
                {e.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatmap.topics.map((t, ti) => (
            <tr key={t.id ?? "none"}>
              <td className="whitespace-nowrap px-2 py-1 text-gray-700">
                {t.name} <span className="text-gray-400">({t.responses})</span>
              </td>
              {grid[ti].map((v, ei) => (
                <td key={ei} className="min-w-[72px] px-2 py-1 text-center tabular-nums" style={heat(v)}>
                  {v}%
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HeatmapSection({ heatmap, metric, hrefFor }: { heatmap: Heatmap; metric: HeatmapMetric; hrefFor: (m: HeatmapMetric) => string }) {
  return (
    <section className="rounded-xl border border-gray-100 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Topic × brand heatmap</h2>
        <MetricTabs metric={metric} hrefFor={hrefFor} />
      </div>
      {heatmap.topics.length === 0 ? (
        <p className="text-sm text-gray-400">No answers in this period.</p>
      ) : (
        <HeatmapTable heatmap={heatmap} grid={metric === "citation" ? heatmap.citation : heatmap.mention} />
      )}
    </section>
  );
}
