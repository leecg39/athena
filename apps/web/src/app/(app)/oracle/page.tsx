import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import {
  listOracleFindings,
  listKnowledgeBase,
  ORACLE_STATUSES,
  ORACLE_TYPES,
  type OracleFindingStatus,
  type OracleFindingType,
} from "@athena/core/knowledge";
import { PageHeader } from "@/components/page-header";
import { OracleList } from "@/components/oracle-list";
import { requireWorkspace } from "@/lib/workspace";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Oracle") };
}

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
  const tt = await getTranslations();
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const currentStatus = parseStatus(sp.status);
  const currentType = parseType(sp.type);

  const [membership, kb, oracle] = await Promise.all([
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

  return (
    <div>
      <PageHeader
        title={tt("Oracle")}
        subtitle={tt("Scan AI responses against your knowledge base — review the evidence, keep your brand facts current")}
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
