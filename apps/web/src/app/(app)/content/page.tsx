import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import { listContentHub, seedInitialContentItems } from "@athena/core/content";
import { PageHeader } from "@/components/page-header";
import { ContentGrid } from "@/components/content-grid";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Content" };

export default async function ContentPage() {
  const ws = await requireWorkspace();
  const [membership, initial] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    listContentHub(db, { actorId: ws.user.id, websiteId: ws.websiteId }),
  ]);
  const canWrite = membership?.permissions.includes("content:write") ?? false;

  let data = initial;
  if (initial.counts.total === 0) {
    await seedInitialContentItems(db, {
      actorId: canWrite ? ws.user.id : undefined,
      websiteId: ws.websiteId,
    });
    data = await listContentHub(db, { actorId: ws.user.id, websiteId: ws.websiteId });
  }

  return (
    <div>
      <PageHeader
        title="Content Hub"
        subtitle="Manage, generate, revise with Athena, and publish AI-optimized content across your CMS and Shopify catalog"
      />
      <div className="p-6 space-y-6">
        {/* KPI Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">Tracked Content Items</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{data.counts.total}</div>
            <div className="mt-1 text-xs text-gray-400">
              {data.counts.brief} brief · {data.counts.draft} draft · {data.counts.review} review
            </div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">AI Revisions Ready</div>
            <div className="mt-1 text-2xl font-semibold text-brand-600">
              {data.counts.draft + data.counts.review + data.counts.approved}
            </div>
            <div className="mt-1 text-xs text-gray-400">Grounded in KB facts & internal links</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">Published to CMS</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-600">{data.counts.published}</div>
            <div className="mt-1 text-xs text-gray-400">Live & monitored for AI citations</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">Connected CMS Targets</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{data.publishTargets.length} / 8</div>
            <div className="mt-1 text-xs text-gray-400">WordPress, Webflow, Contentful, Sanity, Shopify…</div>
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
          publishTargets={data.publishTargets.map((t) => ({
            id: t.id,
            provider: t.provider,
            config: t.config,
          }))}
          prompts={data.prompts}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
