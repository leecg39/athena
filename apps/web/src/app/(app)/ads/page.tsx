import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { getAdsSummary } from "@athena/core/commerce";
import { PageHeader } from "@/components/page-header";
import { AdsCaptureView } from "@/components/ads-capture-view";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Ads") };
}

export default async function AdsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const summary = await getAdsSummary(db, { actorId: s.user.id, websiteId: s.websiteId });
  const canWrite = s.membership.permissions.includes("content:write");

  return (
    <div>
      <PageHeader
        title={tt("Ads")}
        subtitle={tt("Sponsored placements labelled in collected answers plus the ones your team records. AI provider APIs rarely return ads, so most placements are recorded manually.")}
      />
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Captured Sponsored Ads")}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {summary.stats.totalImpressions}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {summary.stats.ownAdCount} {tt(" own · ")}{summary.stats.competitorAdCount} {tt(" competitor placements")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("AI Surface Breakdown")}</div>
            <div className="mt-1 text-lg font-bold text-gray-900">
              {summary.stats.surfaceCounts.chatgpt} {tt(" ChatGPT · ")}{summary.stats.surfaceCounts.ai_mode} {tt(" AI Mode ·")}{tt(" ")}
              {summary.stats.surfaceCounts.ai_overview} {tt(" Overview")}</div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("Placements recorded on ")}{Object.values(summary.stats.surfaceCounts).filter((n) => n > 0).length} {tt(" of 3 surfaces")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Unique Advertisers")}</div>
            <div className="mt-1 text-2xl font-bold text-brand-700">
              {summary.stats.uniqueAdvertisers}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("Bidding on your category & brand prompts")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Prompts Triggering Ads")}</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">
              {summary.stats.promptsWithAdsCount}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("Tracked prompts with active sponsored units")}</div>
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
