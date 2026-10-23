import { db } from "@athena/db";
import { getAdsSummary } from "@athena/core/commerce";
import { PageHeader } from "@/components/page-header";
import { AdsCaptureView } from "@/components/ads-capture-view";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ads" };

export default async function AdsPage() {
  const s = await getSettingsContext();
  const summary = await getAdsSummary(db, { actorId: s.user.id, websiteId: s.websiteId });
  const canWrite = s.membership.permissions.includes("content:write");

  return (
    <div>
      <PageHeader
        title="Ads"
        subtitle="Sponsored placements labelled in collected answers plus the ones your team records. AI provider APIs rarely return ads, so most placements are recorded manually."
      />
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs text-gray-400">Captured Sponsored Ads</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {summary.stats.totalImpressions}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {summary.stats.ownAdCount} own · {summary.stats.competitorAdCount} competitor placements
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">AI Surface Breakdown</div>
            <div className="mt-1 text-lg font-bold text-gray-900">
              {summary.stats.surfaceCounts.chatgpt} ChatGPT · {summary.stats.surfaceCounts.ai_mode} AI Mode ·{" "}
              {summary.stats.surfaceCounts.ai_overview} Overview
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Placements recorded on {Object.values(summary.stats.surfaceCounts).filter((n) => n > 0).length} of 3 surfaces
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">Unique Advertisers</div>
            <div className="mt-1 text-2xl font-bold text-brand-700">
              {summary.stats.uniqueAdvertisers}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Bidding on your category &amp; brand prompts
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">Prompts Triggering Ads</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">
              {summary.stats.promptsWithAdsCount}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Tracked prompts with active sponsored units
            </div>
          </div>
        </div>

        <AdsCaptureView
          impressions={summary.impressions}
          advertiserBreakdown={summary.advertiserBreakdown}
          advertisers={summary.advertisers}
          prompts={summary.prompts}
          surfaceCounts={summary.stats.surfaceCounts}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
