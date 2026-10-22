import { demoCitationSeries, demoMentionSeries, demoCompetitorSoV } from "@/lib/demo";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "AI Search Report" };

/** Public, read-only pitch report (observed: /report/[pitchId]). */
export default async function PublicReportPage(props: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await props.params;
  const citation = demoCitationSeries(14);
  const mention = demoMentionSeries(14);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">🏛</div>
            <span className="font-semibold">Athenum</span>
          </div>
          <span className="badge bg-brand-50 text-brand-600">AI Search Report</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl p-6">
        <PageHeader title={`How ${shareId.replace("demo-", "")} shows up in AI search`} subtitle="Brand mentions, share of voice, competitor analysis and sampled AI responses" />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <MetricCard
            title="Mention Rate"
            subtitle="% of AI responses mentioning the brand"
            value={`${(mention.reduce((a, b) => a + b.brand, 0) / mention.length).toFixed(1)}%`}
            data={mention}
          />
          <MetricCard
            title="Citation Rate"
            subtitle="% of AI responses citing the brand"
            value={`${(citation.reduce((a, b) => a + b.brand, 0) / citation.length).toFixed(1)}%`}
            data={citation}
          />
        </div>

        <div className="metric-card mt-4">
          <div className="mb-3 text-sm font-semibold text-gray-900">Share of voice vs competitors</div>
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

        <div className="mt-6 rounded-xl bg-brand-50 p-6 text-center">
          <div className="text-sm font-medium text-brand-700">Want a report like this for your brand?</div>
          <a href="/signup" className="btn-primary mt-3 inline-flex">Get your free audit</a>
        </div>
      </div>
    </div>
  );
}
