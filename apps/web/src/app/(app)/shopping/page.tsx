import Link from "next/link";
import { db } from "@athena/db";
import { getShoppingInsightsSummary } from "@athena/core/commerce";
import { PageHeader } from "@/components/page-header";
import { ShoppingInsightsView } from "@/components/shopping-insights-view";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shopping Insights" };

export default async function ShoppingPage() {
  const s = await getSettingsContext();
  const summary = await getShoppingInsightsSummary(db, s.websiteId);
  const canWrite = s.membership.permissions.includes("content:write");

  return (
    <div>
      <PageHeader
        title="Shopping Insights"
        subtitle="Track how your products appear in AI shopping carousels (ChatGPT, Google AI Mode, Gemini) — compare positions, pricing, competitors, and retailer distribution"
        actions={
          <Link href="/content/catalog-optimization" className="btn-secondary text-xs">
            🛍 Shopify Catalog Optimization →
          </Link>
        }
      />
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs text-gray-400">Carousel Appearances</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {summary.stats.totalAppearances.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Own share {summary.stats.ownSharePct.toFixed(1)}% ({summary.stats.ownAppearances.toLocaleString()} own ·{" "}
              {summary.stats.competitorAppearances.toLocaleString()} comp)
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">Own Avg Carousel Position</div>
            <div className="mt-1 text-2xl font-bold text-brand-700">
              #{summary.stats.ownAvgPosition.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Competitor avg #{summary.stats.competitorAvgPosition.toFixed(2)} · Overall #
              {summary.stats.overallAvgPosition.toFixed(2)}
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">Avg Price Shown (Own vs Market)</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              ${summary.stats.ownAvgPrice.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Market avg ${summary.stats.marketAvgPrice.toFixed(2)} (
              {summary.stats.priceDeltaPct >= 0 ? "+" : ""}
              {summary.stats.priceDeltaPct.toFixed(1)}% vs comp)
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">Retailer Coverage</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">
              {summary.stats.retailerCoverageCount}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Own brand listed on {summary.stats.ownRetailerCount} of {summary.stats.retailerCoverageCount} retailers
            </div>
          </div>
        </div>

        <ShoppingInsightsView
          products={summary.products}
          brandComparison={summary.brandComparison}
          retailerDistribution={summary.retailerDistribution}
          retailers={summary.retailers}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
