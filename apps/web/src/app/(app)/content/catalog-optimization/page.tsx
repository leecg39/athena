import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import { listCatalogProducts } from "@athena/core/content";
import { PageHeader } from "@/components/page-header";
import { CatalogOptimizationView } from "@/components/catalog-optimization-view";
import { requireWorkspace } from "@/lib/workspace";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Catalog Optimization") };
}

export default async function CatalogOptimizationPage() {
  const tt = await getTranslations();
  const ws = await requireWorkspace();
  const [membership, data] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    listCatalogProducts(db, { actorId: ws.user.id, websiteId: ws.websiteId }),
  ]);
  const canWrite = membership?.permissions.includes("content:write") ?? false;

  return (
    <div>
      <PageHeader
        title={tt("Catalog Optimization (Shopify)")}
        subtitle={tt("Audit product title & description scores, draft grounded copy & FAQs, and publish updates to your Shopify catalog")}
      />
      <div className="p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("Catalog Products")}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{data.stats.totalProducts}</div>
            <div className="mt-1 text-xs text-gray-400">{data.stats.optimizedCount} {tt(" optimized")}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("Avg Title Score")}</div>
            <div className="mt-1 text-2xl font-semibold text-brand-600">{data.stats.avgTitleScore} / 100</div>
            <div className="mt-1 text-xs text-gray-400">{tt("Length, brand & concrete detail")}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("Avg Description Score")}</div>
            <div className="mt-1 text-2xl font-semibold text-brand-600">{data.stats.avgDescScore} / 100</div>
            <div className="mt-1 text-xs text-gray-400">{tt("Depth, bullet list, specs & use cases")}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("FAQ Coverage")}</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-600">{data.stats.faqCoveragePct}%</div>
            <div className="mt-1 text-xs text-gray-400">{tt("Listings with 2+ Q&As")}</div>
          </div>
        </div>

        <CatalogOptimizationView
          products={data.products}
          shopifyConnected={data.shopifyConnected}
          storeDomain={data.storeDomain}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
