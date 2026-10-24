import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { db } from "@athena/db";
import { getSiteHealthSummary } from "@athena/core/site-health";
import { PageHeader } from "@/components/page-header";
import { SiteHealthView } from "@/components/site-health-view";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Site Health") };
}

export default async function SiteHealthPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const summary = await getSiteHealthSummary(db, s.websiteId);
  const canWrite = s.membership.permissions.includes("content:write");

  return (
    <div>
      <PageHeader
        title={tt("Site Health")}
        subtitle={tt("Audit AI search crawler accessibility (OAI-SearchBot, Claude-SearchBot, PerplexityBot), keyword rankings, staging release diffs, sitemap coverage, and live content verification")}
        actions={
          <Link href="/bot" className="btn-secondary text-xs">
            {tt("🤖 AthenaBot Crawler Docs →")}</Link>
        }
      />
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Pages Indexed in Sitemap")}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {summary.stats.indexedPages}/{summary.stats.totalPages}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {summary.stats.verifiedLiveCount} {tt(" verified live · ")}{summary.stats.needsOptimizationCount} {tt(" need edits")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("AI Crawler Accessibility")}</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">
              {summary.stats.aiAccessiblePct}%
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("Evaluated across 10 AI search & citation bots")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Keywords Ranked")}</div>
            <div className="mt-1 text-2xl font-bold text-brand-700">
              {summary.stats.totalKeywords}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("Avg position #")}{summary.stats.avgKeywordPosition.toFixed(1)}
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Failed Checks / Staging Gate")}</div>
            <div className="mt-1 text-2xl font-bold text-amber-600">
              {summary.stats.failedChecksCount}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {summary.stats.stagingRegressionsCount} {tt(" staging release warnings")}</div>
          </div>
        </div>

        <SiteHealthView
          siteDomain={s.website.domain}
          pages={summary.pages}
          botAccessMatrix={summary.botAccessMatrix}
          keywords={summary.keywords}
          stagingComparisons={summary.stagingComparisons}
          properties={summary.properties}
          optimizations={summary.optimizations}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
