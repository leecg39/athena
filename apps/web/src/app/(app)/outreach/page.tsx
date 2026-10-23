import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import { listOutreachOpportunities } from "@athena/core/outreach";
import { PageHeader } from "@/components/page-header";
import { OutreachKanban } from "@/components/outreach-kanban";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const ws = await requireWorkspace();
  // viewing never writes: discovery runs after each collection and from the Discover button
  const [membership, data] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    listOutreachOpportunities(db, { actorId: ws.user.id, websiteId: ws.websiteId }),
  ]);
  const canWrite = membership?.permissions.includes("content:write") ?? false;

  return (
    <div>
      <PageHeader
        title="Outreach"
        subtitle="Triage high-citation third-party pages where AI models omit your brand — find editorial contacts, generate KB-grounded pitch emails, and track placements"
      />
      <div className="p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">Citation Opportunities</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{data.counts.total}</div>
            <div className="mt-1 text-xs text-gray-400">
              {data.counts.new} new · {data.counts.todo} todo · {data.counts.done} done
            </div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500" title="Monthly searches for the prompts whose AI answers cite these pages">Search Demand Behind Cited Pages</div>
            <div className="mt-1 text-2xl font-semibold text-brand-600">
              {data.stats.totalEstimatedImpressions.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-gray-400">Avg citation share {data.stats.avgCitationPct}%</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">Authors Identified</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{data.stats.withAuthorCount}</div>
            <div className="mt-1 text-xs text-gray-400">Found on the pages or added by you</div>
          </div>
          <div className="metric-card">
            <div className="text-xs font-medium text-gray-500">Pitch Drafts Ready</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-600">{data.stats.withDraftCount}</div>
            <div className="mt-1 text-xs text-gray-400">Grounded in verified KB facts</div>
          </div>
        </div>

        <OutreachKanban
          opportunities={data.rows.map((r) => ({
            id: r.id,
            url: r.url,
            domain: r.domain,
            status: r.status,
            citationPct: r.citationPct,
            estimatedImpressions: r.estimatedImpressions,
            citations: r.citations,
            authorName: r.authorName,
            authorEmail: r.authorEmail,
            emailDraft: r.emailDraft,
            notes: r.notes,
          }))}
          counts={data.counts}
          domains={data.domains}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
