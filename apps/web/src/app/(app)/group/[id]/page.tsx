import { PageHeader } from "@/components/page-header";
import { demoCompetitorSoV } from "@/lib/data";

export const metadata = { title: "Group Dashboard" };

export default async function GroupDashboardPage() {
  return (
    <div>
      <PageHeader
        title="Group Dashboard"
        subtitle="Aggregated AI visibility across every website in this group"
        actions={
          <>
            <button className="btn-secondary">Saved views ⌄</button>
            <button className="btn-secondary">Scheduled reports</button>
          </>
        }
      />
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Websites" value="6" />
          <Tile label="Group SOV" value="47.8%" />
          <Tile label="Group mention rate" value="41.2%" />
          <Tile label="Dollar value (est.)" value="$58,400" />
        </div>
        <div className="metric-card">
          <div className="mb-3 text-sm font-semibold text-gray-900">Share of voice by brand</div>
          <div className="space-y-2">
            {demoCompetitorSoV().map((c, i) => (
              <div key={c.name} className="flex items-center gap-3">
                <span className="w-32 text-xs text-gray-600">{i === 0 ? "Canvasly (you)" : c.name}</span>
                <div className="h-2.5 flex-1 rounded-full bg-gray-100">
                  <div className={`h-2.5 rounded-full ${i === 0 ? "bg-brand-600" : "bg-gray-300"}`} style={{ width: `${c.sov}%` }} />
                </div>
                <span className="w-12 text-right text-xs font-medium">{c.sov}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile(props: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="text-xs text-gray-400">{props.label}</div>
      <div className="mt-1 text-xl font-bold text-gray-900">{props.value}</div>
    </div>
  );
}
