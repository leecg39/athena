import { db } from "@athena/db";
import { getAdsSummary } from "@athena/core/commerce";
import { PageHeader } from "@/components/page-header";
import { AdsCaptureView } from "@/components/ads-capture-view";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ads" };

export default async function AdsPage() {
  const s = await getSettingsContext();
  const summary = await getAdsSummary(db, s.websiteId);
  const canWrite = s.membership.permissions.includes("content:write");

  return (
    <div>
      <PageHeader
        title="Ads"
        subtitle="Sponsored ads captured across ChatGPT, Google AI Mode, and Google AI Overview responses to your tracked prompts"
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
              Active across all 3 sponsored AI answer surfaces
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
