import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import { listKnowledgeBase } from "@athena/core/knowledge";
import { PageHeader } from "@/components/page-header";
import { KbWorkspace } from "@/components/kb-workspace";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Knowledge Base" };

export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const initialTab = sp.tab === "review" ? "review" : sp.tab === "links" ? "links" : "pillars";

  const [membership, data] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    listKnowledgeBase(db, { actorId: ws.user.id, websiteId: ws.websiteId }),
  ]);
  const canWrite = membership?.permissions.includes("content:write") ?? false;

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        subtitle="Verified brand facts, approval queue, and internal link pages that ground AI research, content generation and Oracle accuracy checks"
      />
      <KbWorkspace
        websiteDomain={ws.website.domain}
        pillars={data.pillars.map((p) => ({
          id: p.id,
          name: p.name,
          document: p.document,
          confirmedCount: p.confirmedCount,
          pendingCount: p.pendingCount,
        }))}
        facts={data.facts.map((f) => ({
          id: f.id,
          pillarId: f.pillarId,
          pillarName: f.pillarName,
          claim: f.claim,
          sourceUrl: f.sourceUrl,
          status: f.status,
          confidence: f.confidence,
        }))}
        internalLinks={data.internalLinks.map((l) => ({
          id: l.id,
          url: l.url,
          title: l.title,
          keywords: l.keywords,
          factCount: l.factCount,
          citationCount: l.citationCount,
        }))}
        counts={data.counts}
        initialTab={initialTab}
        canWrite={canWrite}
      />
    </div>
  );
}
