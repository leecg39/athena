import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import {
  listOracleFindings,
  runOracleScan,
  listKnowledgeBase,
  extractKnowledgeFacts,
  ORACLE_STATUSES,
  ORACLE_TYPES,
  type OracleFindingStatus,
  type OracleFindingType,
} from "@athena/core/knowledge";
import { PageHeader } from "@/components/page-header";
import { OracleList } from "@/components/oracle-list";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Oracle" };

function parseStatus(raw?: string): OracleFindingStatus | "all" {
  if (raw === "all") return "all";
  if (raw && (ORACLE_STATUSES as readonly string[]).includes(raw)) return raw as OracleFindingStatus;
  return "open";
}

function parseType(raw?: string): OracleFindingType | "all" {
  if (raw && (ORACLE_TYPES as readonly string[]).includes(raw)) return raw as OracleFindingType;
  return "all";
}

export default async function OraclePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const currentStatus = parseStatus(sp.status);
  const currentType = parseType(sp.type);

  const [membership, initialKb, initialOracle] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    listKnowledgeBase(db, { actorId: ws.user.id, websiteId: ws.websiteId }),
    listOracleFindings(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      status: currentStatus === "all" ? undefined : currentStatus,
      type: currentType === "all" ? undefined : currentType,
    }),
  ]);
  const canWrite = membership?.permissions.includes("content:write") ?? false;

  let kb = initialKb;
  let oracle = initialOracle;

  if (initialOracle.counts.total === 0) {
    if (kb.counts.pillars === 0) {
      await extractKnowledgeFacts(db, {
        actorId: canWrite ? ws.user.id : undefined,
        websiteId: ws.websiteId,
      });
      kb = await listKnowledgeBase(db, { actorId: ws.user.id, websiteId: ws.websiteId });
    }
    await runOracleScan(db, {
      actorId: canWrite ? ws.user.id : undefined,
      websiteId: ws.websiteId,
    });
    oracle = await listOracleFindings(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      status: currentStatus === "all" ? undefined : currentStatus,
      type: currentType === "all" ? undefined : currentType,
    });
  }

  return (
    <div>
      <PageHeader
        title="Oracle"
        subtitle="Scan AI responses against your knowledge base — review the evidence, keep your brand facts current"
      />
      <div className="p-6">
        <OracleList
          findings={oracle.rows.map((f) => ({
            id: f.id,
            responseId: f.responseId,
            factId: f.factId,
            type: f.type,
            status: f.status,
            claim: f.claim,
            evidence: f.evidence,
            models: f.models,
            createdAt: f.createdAt.toISOString(),
          }))}
          pillars={kb.pillars.map((p) => ({ id: p.id, name: p.name }))}
          counts={oracle.counts}
          typeCounts={oracle.typeCounts}
          currentStatus={currentStatus}
          currentType={currentType}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
