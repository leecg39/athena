import { PageHeader } from "@/components/page-header";
import { CompetitorHeatmap } from "@/components/competitor-heatmap";
import { getCompetitorList, demoHeatmap, demoCompetitorSoV } from "@/lib/data";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Competitors" };

export default async function CompetitorsPage() {
  const ws = await requireWorkspace();
  const competitors = await getCompetitorList(ws.websiteId);
  const hm = demoHeatmap();
  return (
    <div>
      <PageHeader
        title="Competitors"
        subtitle="Track competitor brands and review AI-visibility comparisons"
        actions={
          <>
            <button className="btn-secondary">Discover competitors</button>
            <button className="btn-primary">+ Add competitor</button>
          </>
        }
      />
      <div className="space-y-4 p-6">
        {/* share-of-voice bar */}
        <div className="metric-card">
          <div className="mb-3 text-sm font-semibold text-gray-900">Share of Voice</div>
          <div className="space-y-2">
            {demoCompetitorSoV().map((c) => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="w-28 text-xs text-gray-600">{c.name}</span>
                <div className="h-2.5 flex-1 rounded-full bg-gray-100">
                  <div className="h-2.5 rounded-full bg-brand-600" style={{ width: `${c.sov}%` }} />
                </div>
                <span className="w-12 text-right text-xs font-medium text-gray-700">{c.sov}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">Tracked competitors ({competitors.length})</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {competitors.map((c) => (
              <span key={c.id} className="badge bg-gray-100 text-gray-700">
                {c.name} · {c.domain} <button className="ml-1 text-gray-300 hover:text-red-400">×</button>
              </span>
            ))}
          </div>
        </div>

        <CompetitorHeatmap topics={hm.topics} competitors={hm.competitors} mention={hm.mention} citation={hm.citation} />
      </div>
    </div>
  );
}
