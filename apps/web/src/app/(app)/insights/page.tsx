import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import {
  listInsights,
  generateInsights,
  INSIGHT_KINDS,
  INSIGHT_STATUSES,
  type InsightKind,
  type InsightStatus,
} from "@athena/core/insights";
import { PageHeader } from "@/components/page-header";
import { InsightsList } from "@/components/insights-list";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Insights" };

function parseStatus(raw?: string): InsightStatus | "all" {
  if (raw === "all") return "all";
  if (raw && (INSIGHT_STATUSES as readonly string[]).includes(raw)) return raw as InsightStatus;
  return "active";
}

function parseKind(raw?: string): InsightKind | "all" {
  if (raw && (INSIGHT_KINDS as readonly string[]).includes(raw)) return raw as InsightKind;
  return "all";
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string }>;
}) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const currentStatus = parseStatus(sp.status);
  const currentKind = parseKind(sp.kind);

  const [membership, initial] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    listInsights(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      status: currentStatus === "all" ? undefined : currentStatus,
      kind: currentKind === "all" ? undefined : currentKind,
    }),
  ]);
  const canWrite = membership?.permissions.includes("prompts:write") ?? false;

  // If this workspace has never had insights generated yet, evaluate once from stored metrics
  let data = initial;
  if (initial.counts.total === 0) {
    await generateInsights(db, {
      actorId: canWrite ? ws.user.id : undefined,
      websiteId: ws.websiteId,
    });
    data = await listInsights(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      status: currentStatus === "all" ? undefined : currentStatus,
      kind: currentKind === "all" ? undefined : currentKind,
    });
  }

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="AI-generated proactive insights, content gaps, and competitor movements"
      />
      <div className="p-6">
        <InsightsList
          insights={data.rows.map((r) => ({
            id: r.id,
            title: r.title,
            body: r.body,
            kind: r.kind,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
            action: r.action,
          }))}
          counts={data.counts}
          kindCounts={data.kindCounts}
          currentStatus={currentStatus}
          currentKind={currentKind}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
