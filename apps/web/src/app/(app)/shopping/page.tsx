import Link from "next/link";
import { db } from "@athena/db";
import { getShoppingInsightsSummary } from "@athena/core/commerce";
import { PageHeader } from "@/components/page-header";
import { ShoppingInsightsView } from "@/components/shopping-insights-view";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";
/** positions and prices are unknown (not zero) until answers show products */
const pos = (v: number) => (v > 0 ? `#${v.toFixed(2)}` : "—");
const money = (v: number) => (v > 0 ? `$${v.toFixed(2)}` : "—");

export const metadata = { title: "Shopping Insights" };

export default async function ShoppingPage() {
  const s = await getSettingsContext();
  const summary = await getShoppingInsightsSummary(db, { actorId: s.user.id, websiteId: s.websiteId });
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
        {summary.stats.totalAppearances === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            No product cards in collected answers yet. They appear when AI answers list products with prices (for example, shopping prompts); syncing reads them from your collected answers.
          </p>
        ) : null}
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
              {pos(summary.stats.ownAvgPosition)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Competitor avg {pos(summary.stats.competitorAvgPosition)} · Overall {pos(summary.stats.overallAvgPosition)}
            </div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">Avg Price Shown (Own vs Market)</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {money(summary.stats.ownAvgPrice)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Market avg {money(summary.stats.marketAvgPrice)} (
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
