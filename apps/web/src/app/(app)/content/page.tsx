import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import { cmsConnectionSchema, listContentHub, listPublishTargets } from "@athena/core/content";
import { PageHeader } from "@/components/page-header";
import { ContentGrid } from "@/components/content-grid";
import { requireWorkspace } from "@/lib/workspace";

// publishing runs multi-step CMS flows (Contentful, Wix: up to 3 requests of 20s) and waits for a Framer deployment from this page's actions
export const maxDuration = 120;

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Content") };
}

export default async function ContentPage() {
  const tt = await getTranslations();
  const ws = await requireWorkspace();
  // viewing never writes: the grid starts empty until the team adds or imports content
  const [membership, data, targets] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    listContentHub(db, { actorId: ws.user.id, websiteId: ws.websiteId }),
    listPublishTargets(db, { actorId: ws.user.id, websiteId: ws.websiteId }),
  ]);
  const canWrite = membership?.permissions.includes("content:write") ?? false;

  return (
    <div>
      <PageHeader
        title={tt("Content Hub")}
        subtitle={tt("Manage, generate, revise with Athena, and publish AI-optimized content across your CMS and Shopify catalog")}
      />
      <div className="p-6 space-y-6">
        {/* KPI Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("Tracked Content Items")}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{data.counts.total}</div>
            <div className="mt-1 text-xs text-gray-400">
              {data.counts.brief} {tt(" brief · ")}{data.counts.draft} {tt(" draft · ")}{data.counts.review} {tt(" review")}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("AI Revisions Ready")}</div>
            <div className="mt-1 text-2xl font-semibold text-brand-600">
              {data.counts.draft + data.counts.review + data.counts.approved}
            </div>
            <div className="mt-1 text-xs text-gray-400">{tt("Grounded in KB facts & internal links")}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("Published to CMS")}</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-600">{data.counts.published}</div>
            <div className="mt-1 text-xs text-gray-400">{tt("Live & monitored for AI citations")}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">{tt("Connected CMS Targets")}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{targets.filter((t) => t.configured).length}</div>
            <div className="mt-1 text-xs text-gray-400">{tt("WordPress, Webflow, Contentful, Sanity, Wix, Framer, Payload, Shopify")}</div>
          </div>
        </div>

        <ContentGrid
          websiteDomain={ws.website.domain}
          items={data.items.map((item) => ({
            id: item.id,
            title: item.title,
            targetUrl: item.targetUrl,
            promptId: item.promptId,
            promptText: item.promptText,
            status: item.status,
            columns: item.columns,
            agentStage: item.agentStage,
            citations30d: item.citations30d,
            latestBrief: item.latestBrief
              ? {
                  id: item.latestBrief.id,
                  body: item.latestBrief.body,
                  approvedAt: item.latestBrief.approvedAt ? item.latestBrief.approvedAt.toISOString() : null,
                  createdAt: item.latestBrief.createdAt.toISOString(),
                }
              : null,
            latestDraft: item.latestDraft
              ? {
                  id: item.latestDraft.id,
                  body: item.latestDraft.body,
                  createdAt: item.latestDraft.createdAt.toISOString(),
                }
              : null,
            versions: item.versions.map((v) => ({
              id: v.id,
              version: v.version,
              body: v.body,
              createdAt: v.createdAt.toISOString(),
            })),
            createdAt: item.createdAt.toISOString(),
          }))}
          counts={data.counts}
          publishTargets={targets.map((t) => ({ id: t.id, provider: t.provider, label: t.label, configured: t.configured, config: t.config }))}
          cmsSchema={cmsConnectionSchema()}
          prompts={data.prompts}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
