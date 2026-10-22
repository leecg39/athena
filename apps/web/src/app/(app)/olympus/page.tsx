import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { getDashboardData } from "@/lib/data";
import { getUser } from "@/lib/session";

export const metadata = { title: "Olympus Dashboard" };

export default async function OlympusPage() {
  await getUser();
  const data = await getDashboardData();

  return (
    <div>
      <PageHeader
        title="Olympus Dashboard"
        subtitle="AI search visibility: mentions, citations, share of voice, position and business value"
        actions={
          <>
            <button className="btn-secondary">Saved views ⌄</button>
            <button className="btn-secondary">⬇ Export</button>
            <button className="btn-primary">+ Add card</button>
          </>
        }
      />
      <div className="space-y-4 p-6">
        {/* summary strip */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <SummaryTile label="Mention rate" value={`${data.summary.mentionRate}%`} delta="+2.1pt" />
          <SummaryTile label="Citation rate" value={`${data.summary.citationRate}%`} delta="+1.4pt" />
          <SummaryTile label="Share of voice" value={`${data.summary.sov}%`} delta="+3.8pt" />
          <SummaryTile label="Avg position" value={`#${data.summary.position}`} delta="-0.4" />
          <SummaryTile label="AI search value" value={`$${data.summary.value.toLocaleString()}`} delta="+12%" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <MetricCard
            title="Citation Rate"
            subtitle="How often AI cites your content"
            value={`${data.summary.citationRate}%`}
            suffix="average citation rate"
            data={data.citation}
          />
          <MetricCard
            title="Mention Rate"
            subtitle="How often AI mentions your brand"
            value={`${data.summary.mentionRate}%`}
            suffix="average mention rate"
            data={data.mention}
          />
          <MetricCard
            title="Share of Voice"
            subtitle="Your share of brand mentions vs competitors"
            value={`${data.summary.sov}%`}
            suffix="of tracked brands"
            data={data.mention}
          />
          <MetricCard
            title="AI Search Value"
            subtitle="Estimated business value of AI search presence"
            value={`$${data.summary.value.toLocaleString()}`}
            suffix="est. monthly"
            data={data.citation}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryTile(props: { label: string; value: string; delta: string }) {
  const positive = !props.delta.startsWith("-");
  return (
    <div className="metric-card">
      <div className="text-xs text-gray-400">{props.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-bold text-gray-900">{props.value}</span>
        <span className={`text-xs ${positive ? "text-emerald-600" : "text-red-500"}`}>
          {positive ? "▲" : "▼"} {props.delta.replace("-", "")}
        </span>
      </div>
    </div>
  );
}
