import { PageHeader } from "@/components/page-header";
import { InsightsList } from "@/components/insights-list";
import { demoInsights } from "@/lib/data";

export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="AI-generated proactive insights and content opportunities"
      />
      <div className="p-6">
        <InsightsList insights={demoInsights.map((i) => ({ ...i }))} />
      </div>
    </div>
  );
}
