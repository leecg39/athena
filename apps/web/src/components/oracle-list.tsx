"use client";
import { useTranslations } from "@/components/locale-provider";


import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { OracleFindingStatus, OracleFindingType } from "@athena/core/knowledge";
import type { ActionState } from "@/lib/action-state";
import {
  runOracleScanAction,
  updateOracleStatusAction,
  resolveWithFactAction,
} from "@/app/(app)/oracle/actions";

const idle: ActionState = { ok: false };

const TYPE_META: Record<OracleFindingType, { label: string; badge: string }> = {
  confirmed_inaccuracy: { label: "Confirmed inaccuracy", badge: "bg-red-50 text-red-600" },
  kb_inconsistency: { label: "KB inconsistency", badge: "bg-amber-50 text-amber-700" },
  model_disagreement: { label: "Model disagreement", badge: "bg-purple-50 text-purple-700" },
};

const STATUS_META: Record<OracleFindingStatus, { label: string; badge: string }> = {
  open: { label: "Open", badge: "bg-red-50 text-red-600" },
  resolving: { label: "Resolving", badge: "bg-amber-50 text-amber-700" },
  resolved: { label: "Resolved", badge: "bg-emerald-50 text-emerald-700" },
  dismissed: { label: "Dismissed", badge: "bg-gray-100 text-gray-500" },
};

export interface SerializedOracleFinding {
  id: string;
  responseId: string | null;
  factId: string | null;
  type: OracleFindingType;
  status: OracleFindingStatus;
  claim: string;
  evidence: string;
  models: string[];
  createdAt: string;
}

export function OracleList(props: {
  findings: SerializedOracleFinding[];
  pillars: { id: string; name: string }[];
  counts: { open: number; resolving: number; resolved: number; dismissed: number; total: number };
  typeCounts: Record<OracleFindingType, number>;
  currentStatus: OracleFindingStatus | "all";
  currentType: OracleFindingType | "all";
  canWrite: boolean;
}) {
  const tt = useTranslations();
  const router = useRouter();
  const [scanState, scanAct, scanPending] = useActionState(runOracleScanAction, idle);
  const [statusState, statusAct, statusPending] = useActionState(updateOracleStatusAction, idle);
  const [resolveFactState, resolveFactAct, resolveFactPending] = useActionState(resolveWithFactAction, idle);
  const [lastAction, setLastAction] = useState<"scan" | "status" | "resolveFact">("scan");
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [askingId, setAskingId] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  function hrefFor(patch: { status?: OracleFindingStatus | "all"; type?: OracleFindingType | "all" }) {
    const nextStatus = patch.status ?? props.currentStatus;
    const nextType = patch.type ?? props.currentType;
    const params = new URLSearchParams();
    if (nextStatus !== "open") params.set("status", nextStatus);
    if (nextType !== "all") params.set("type", nextType);
    const qs = params.toString();
    return qs ? `/oracle?${qs}` : "/oracle";
  }

  async function askAthena(findingId: string, claim: string, evidence: string) {
    if (askingId) return;
    setAskingId(findingId);
    setAskError(null);
    try {
      const prompt = `Oracle detected an AI accuracy issue: "${claim}". Evidence: ${evidence}. How should we update our content and Knowledge Base to correct AI models on this?`;
      const res = await fetch("/api/athena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, attachments: [] }),
      });
      const data = (await res.json().catch(() => ({}))) as { threadId?: string; error?: string };
      if (!res.ok || !data.threadId) {
        setAskError(data.error ?? "Could not start Ask Athena chat.");
        setAskingId(null);
        return;
      }
      router.push(`/chat?id=${encodeURIComponent(data.threadId)}`);
    } catch {
      setAskError("Network error while starting Ask Athena chat.");
      setAskingId(null);
    }
  }

  const orderedStates =
    lastAction === "status"
      ? [statusState, resolveFactState, scanState]
      : lastAction === "resolveFact"
        ? [resolveFactState, statusState, scanState]
        : [scanState, statusState, resolveFactState];

  const banner = askError || orderedStates.find((s) => s.error)?.error;
  const notice = orderedStates.find((s) => s.message)?.message;

  const statusTabs: { key: OracleFindingStatus | "all"; label: string; count: number }[] = [
    { key: "open", label: "Open", count: props.counts.open },
    { key: "resolving", label: "Resolving", count: props.counts.resolving },
    { key: "resolved", label: "Resolved", count: props.counts.resolved },
    { key: "dismissed", label: "Dismissed", count: props.counts.dismissed },
    { key: "all", label: "All", count: props.counts.total },
  ];

  const totalForSelectedStatus =
    props.currentStatus === "all" ? props.counts.total : props.counts[props.currentStatus];

  const typeTabs: { key: OracleFindingType | "all"; label: string; count: number }[] = [
    { key: "all", label: "All types", count: totalForSelectedStatus },
    { key: "confirmed_inaccuracy", label: "Confirmed inaccuracies", count: props.typeCounts.confirmed_inaccuracy },
    { key: "kb_inconsistency", label: "KB inconsistencies", count: props.typeCounts.kb_inconsistency },
    { key: "model_disagreement", label: "Model disagreements", count: props.typeCounts.model_disagreement },
  ];

  return (
    <div className="space-y-5">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={tt("Oracle finding status")}>
          {statusTabs.map((t) => {
            const active = props.currentStatus === t.key;
            return (
              <Link
                key={t.key}
                href={hrefFor({ status: t.key })}
                role="tab"
                aria-selected={active}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active ? "bg-brand-600 text-white shadow-xs" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span>{tt(t.label)}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {t.count}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Link href="/knowledge-base" className="btn-secondary !px-3 !py-1.5 text-xs">
            {tt("Manage Knowledge Base →")}</Link>
          {props.canWrite ? (
            <form action={scanAct} onSubmit={() => setLastAction("scan")} className="flex items-center gap-2">
              <label htmlFor="oracle-days" className="sr-only">
                {tt("Lookback window")}</label>
              <select
                id="oracle-days"
                name="days"
                defaultValue="30"
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700"
              >
                <option value="7">{tt("Last 7 days")}</option>
                <option value="14">{tt("Last 14 days")}</option>
                <option value="30">{tt("Last 30 days")}</option>
                <option value="90">{tt("Last 90 days")}</option>
              </select>
              <button type="submit" disabled={scanPending} className="btn-primary !px-3 !py-1.5 text-xs">
                {tt(scanPending ? "Scanning…" : "Run scan")}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tt("Oracle finding type")}>
        {typeTabs.map((t) => {
          const active = props.currentType === t.key;
          return (
            <Link
              key={t.key}
              href={hrefFor({ type: t.key })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              <span>{tt(t.label)}</span>
              <span className="text-[11px] text-gray-400">({t.count})</span>
            </Link>
          );
        })}
      </div>

      {banner ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {tt(banner)}
        </div>
      ) : null}
      {!banner && notice ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {tt(notice)}
        </div>
      ) : null}

      {/* Findings list */}
      <div className="space-y-3">
        {props.findings.map((f) => {
          const typeMeta = TYPE_META[f.type] ?? { label: f.type, badge: "bg-gray-100 text-gray-600" };
          const statusMeta = STATUS_META[f.status];
          const isFixing = fixingId === f.id;

          return (
            <div key={f.id} data-testid="oracle-finding-card" data-status={f.status} data-type={f.type} className="metric-card">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${typeMeta.badge}`}>{tt(typeMeta.label)}</span>
                    {props.currentStatus === "all" || f.status !== "open" ? (
                      <span className={`badge ${statusMeta.badge}`}>{tt(statusMeta.label)}</span>
                    ) : null}
                    <div className="text-sm font-semibold text-gray-900">{f.claim}</div>
                  </div>

                  <div className="mt-2 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
                    “{f.evidence}”
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {f.models.map((m) => (
                      <span key={m} className="badge bg-gray-100 text-gray-600">
                        {tt(m)}
                      </span>
                    ))}
                    {f.responseId ? (
                      <Link href={`/responses/${f.responseId}`} className="text-xs font-medium text-brand-600 hover:underline">
                        {tt("View AI response →")}</Link>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {props.canWrite && (f.status === "open" || f.status === "resolving") ? (
                    <button
                      type="button"
                      onClick={() => setFixingId(isFixing ? null : f.id)}
                      className="btn-primary !px-3 !py-1.5 text-xs"
                    >
                      {tt(isFixing ? "Close KB editor" : "Fix KB & Resolve")}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    disabled={askingId !== null}
                    onClick={() => void askAthena(f.id, f.claim, f.evidence)}
                    className="btn-secondary !px-3 !py-1.5 text-xs"
                  >
                    {tt(askingId === f.id ? "Opening chat…" : "Ask Athena")}
                  </button>

                  {props.canWrite ? (
                    <>
                      {f.status === "open" ? (
                        <form action={statusAct} onSubmit={() => setLastAction("status")}>
                          <input type="hidden" name="findingId" value={f.id} />
                          <input type="hidden" name="status" value="resolving" />
                          <button type="submit" disabled={statusPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                            {tt("Start resolving")}</button>
                        </form>
                      ) : null}

                      {f.status !== "resolved" ? (
                        <form action={statusAct} onSubmit={() => setLastAction("status")}>
                          <input type="hidden" name="findingId" value={f.id} />
                          <input type="hidden" name="status" value="resolved" />
                          <button type="submit" disabled={statusPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                            {tt("Resolve")}</button>
                        </form>
                      ) : null}

                      {f.status !== "dismissed" ? (
                        <form action={statusAct} onSubmit={() => setLastAction("status")}>
                          <input type="hidden" name="findingId" value={f.id} />
                          <input type="hidden" name="status" value="dismissed" />
                          <button type="submit" disabled={statusPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                            {tt("Dismiss")}</button>
                        </form>
                      ) : null}

                      {f.status === "resolved" || f.status === "dismissed" ? (
                        <form action={statusAct} onSubmit={() => setLastAction("status")}>
                          <input type="hidden" name="findingId" value={f.id} />
                          <input type="hidden" name="status" value="open" />
                          <button type="submit" disabled={statusPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                            {tt("Reopen")}</button>
                        </form>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>

              {isFixing && props.canWrite ? (
                <form
                  action={resolveFactAct}
                  onSubmit={() => {
                    setLastAction("resolveFact");
                    setFixingId(null);
                  }}
                  className="mt-4 space-y-2 border-t border-gray-100 pt-3"
                >
                  <input type="hidden" name="findingId" value={f.id} />
                  <div className="text-xs font-medium text-gray-700">
                    {tt("Confirm the authoritative brand fact in Knowledge Base and mark this finding resolved:")}</div>
                  <div className="grid gap-2 md:grid-cols-4">
                    <select
                      name="pillarId"
                      defaultValue={props.pillars[0]?.id ?? ""}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {props.pillars.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      name="claim"
                      defaultValue={f.claim}
                      required
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs md:col-span-2"
                    />
                    <div className="flex gap-2">
                      <input
                        name="sourceUrl"
                        placeholder={tt("Source URL (optional)")}
                        className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs"
                      />
                      <button type="submit" disabled={resolveFactPending} className="btn-primary shrink-0 !px-3 !py-1.5 text-xs">
                        {tt("Save & Resolve")}</button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
          );
        })}

        {props.findings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
            {tt("No ")}{tt(props.currentStatus === "all" ? "" : `${props.currentStatus} `)}{tt("findings for this filter. Oracle scans AI responses against your knowledge base every run.")}</div>
        ) : null}
      </div>
    </div>
  );
}
