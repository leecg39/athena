"use client";
import { useTranslations } from "@/components/locale-provider";


import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { InsightKind, InsightStatus } from "@athena/core/insights";
import type { ActionState } from "@/lib/action-state";
import { generateInsightsAction, updateInsightStatusAction } from "@/app/(app)/insights/actions";

const idle: ActionState = { ok: false };

const KIND_META: Record<InsightKind, { label: string; badge: string }> = {
  opportunity: { label: "Opportunity", badge: "bg-emerald-50 text-emerald-700" },
  gap: { label: "Content gap", badge: "bg-amber-50 text-amber-700" },
  competitor_move: { label: "Competitor move", badge: "bg-purple-50 text-purple-700" },
  integrity: { label: "Integrity", badge: "bg-red-50 text-red-600" },
};

const STATUS_META: Record<InsightStatus, { label: string; badge: string }> = {
  active: { label: "Active", badge: "bg-brand-50 text-brand-700" },
  resolved: { label: "Resolved", badge: "bg-emerald-50 text-emerald-700" },
  discarded: { label: "Discarded", badge: "bg-gray-100 text-gray-500" },
};

export interface SerializedInsight {
  id: string;
  title: string;
  body: string;
  kind: InsightKind;
  status: InsightStatus;
  createdAt: string;
  action: {
    signalKey?: string;
    label?: string;
    href?: string;
    askPrompt?: string;
    metrics?: Record<string, string | number | null>;
    updatedAt?: string;
  };
}

function formatMetricLabel(key: string): string {
  switch (key) {
    case "citationRate":
      return "Citation rate";
    case "brandMentionRate":
      return "Brand mention";
    case "competitorMentionRate":
      return "Competitor mention";
    case "mentionRate":
      return "Mention rate";
    case "previousMentionRate":
      return "Prev mention";
    case "shareOfVoice":
    case "brandSoV":
      return "Brand SoV";
    case "competitorSoV":
      return "Competitor SoV";
    case "lossRate":
      return "Loss rate";
    case "lostAnswers":
      return "Lost answers";
    case "totalAnswers":
    case "responses":
      return "Answers";
    case "gapPts":
    case "leadPts":
      return "Gap";
    case "deltaPts":
      return "Change";
    case "leaderMentionRate":
      return "Leader mention";
    default:
      return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  }
}

function formatMetricValue(key: string, val: string | number | null): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "number") {
    if (key.toLowerCase().includes("rate") || key.toLowerCase().includes("sov")) return `${val}%`;
    if (key.endsWith("Pts")) return `${val > 0 ? `+${val}` : val} pts`;
  }
  return String(val);
}

export function InsightsList(props: {
  insights: SerializedInsight[];
  counts: { active: number; resolved: number; discarded: number; total: number };
  kindCounts: Record<InsightKind, number>;
  currentStatus: InsightStatus | "all";
  currentKind: InsightKind | "all";
  canWrite: boolean;
}) {
  const tt = useTranslations();
  const router = useRouter();
  const [genState, genAction, genPending] = useActionState(generateInsightsAction, idle);
  const [statusState, statusAction, statusPending] = useActionState(updateInsightStatusAction, idle);
  const [lastAction, setLastAction] = useState<"gen" | "status">("gen");
  const [askingId, setAskingId] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  function hrefFor(patch: { status?: InsightStatus | "all"; kind?: InsightKind | "all" }) {
    const nextStatus = patch.status ?? props.currentStatus;
    const nextKind = patch.kind ?? props.currentKind;
    const params = new URLSearchParams();
    if (nextStatus !== "active") params.set("status", nextStatus);
    if (nextKind !== "all") params.set("kind", nextKind);
    const qs = params.toString();
    return qs ? `/insights?${qs}` : "/insights";
  }

  async function askAthena(insightId: string, prompt: string) {
    if (askingId) return;
    setAskingId(insightId);
    setAskError(null);
    try {
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

  const statusTabs: { key: InsightStatus | "all"; label: string; count: number }[] = [
    { key: "active", label: "Active", count: props.counts.active },
    { key: "resolved", label: "Resolved", count: props.counts.resolved },
    { key: "discarded", label: "Discarded", count: props.counts.discarded },
    { key: "all", label: "All", count: props.counts.total },
  ];

  const totalForSelectedStatus =
    props.currentStatus === "all" ? props.counts.total : props.counts[props.currentStatus];

  const kindTabs: { key: InsightKind | "all"; label: string; count: number }[] = [
    { key: "all", label: "All types", count: totalForSelectedStatus },
    { key: "opportunity", label: "Opportunities", count: props.kindCounts.opportunity },
    { key: "gap", label: "Content gaps", count: props.kindCounts.gap },
    { key: "competitor_move", label: "Competitor moves", count: props.kindCounts.competitor_move },
  ];

  const primaryState = lastAction === "status" ? statusState : genState;
  const secondaryState = lastAction === "status" ? genState : statusState;
  const banner = askError || primaryState.error || secondaryState.error;
  const notice = primaryState.message || secondaryState.message;

  return (
    <div className="space-y-5">
      {/* Top toolbar: status tabs + refresh button */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={tt("Insight status")}>
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

        {props.canWrite ? (
          <form action={genAction} onSubmit={() => setLastAction("gen")} className="flex items-center gap-2">
            <label htmlFor="insights-days" className="sr-only">
              {tt("Lookback window")}</label>
            <select
              id="insights-days"
              name="days"
              defaultValue="30"
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700"
            >
              <option value="7">{tt("Last 7 days")}</option>
              <option value="14">{tt("Last 14 days")}</option>
              <option value="30">{tt("Last 30 days")}</option>
              <option value="90">{tt("Last 90 days")}</option>
            </select>
            <button type="submit" disabled={genPending} className="btn-primary !px-3 !py-1.5 text-xs">
              {tt(genPending ? "Evaluating…" : "Refresh insights")}
            </button>
          </form>
        ) : null}
      </div>

      {/* Kind filter pills */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tt("Insight category")}>
        {kindTabs.map((k) => {
          const active = props.currentKind === k.key;
          return (
            <Link
              key={k.key}
              href={hrefFor({ kind: k.key })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              <span>{tt(k.label)}</span>
              <span className="text-[11px] text-gray-400">({k.count})</span>
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

      {/* Insights list */}
      <div className="space-y-3">
        {props.insights.map((i) => {
          const kindMeta = KIND_META[i.kind] ?? { label: i.kind, badge: "bg-gray-100 text-gray-600" };
          const statusMeta = STATUS_META[i.status];
          const metricEntries = Object.entries(i.action.metrics ?? {}).filter(
            ([k, v]) => v !== null && v !== undefined && k !== "prompt" && k !== "domain" && k !== "topic" && k !== "competitor" && k !== "leader",
          );

          return (
            <div key={i.id} className="metric-card" data-testid="insight-card" data-status={i.status} data-kind={i.kind}>
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${kindMeta.badge}`}>{tt(kindMeta.label)}</span>
                    {props.currentStatus === "all" || i.status !== "active" ? (
                      <span className={`badge ${statusMeta.badge}`}>{tt(statusMeta.label)}</span>
                    ) : null}
                    <h3 className="text-sm font-semibold text-gray-900">{tt(i.title)}</h3>
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{tt(i.body)}</p>

                  {metricEntries.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {metricEntries.slice(0, 4).map(([k, v]) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs text-gray-600 ring-1 ring-gray-200/70"
                        >
                          <span className="text-gray-400">{tt(formatMetricLabel(k))}:</span>
                          <span className="font-medium text-gray-800">{formatMetricValue(k, v)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {i.action.href ? (
                    <Link href={i.action.href} className="btn-primary !px-3 !py-1.5 text-xs">
                      {tt(i.action.label ?? "Act on it")}
                    </Link>
                  ) : null}

                  {i.action.askPrompt ? (
                    <button
                      type="button"
                      disabled={askingId !== null}
                      onClick={() => void askAthena(i.id, i.action.askPrompt!)}
                      className="btn-secondary !px-3 !py-1.5 text-xs"
                    >
                      {tt(askingId === i.id ? "Opening chat…" : "Ask Athena")}
                    </button>
                  ) : null}

                  {props.canWrite ? (
                    <>
                      {i.status !== "resolved" ? (
                        <form action={statusAction} onSubmit={() => setLastAction("status")}>
                          <input type="hidden" name="insightId" value={i.id} />
                          <input type="hidden" name="status" value="resolved" />
                          <button type="submit" disabled={statusPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                            {tt("Resolve")}</button>
                        </form>
                      ) : null}

                      {i.status !== "discarded" ? (
                        <form action={statusAction} onSubmit={() => setLastAction("status")}>
                          <input type="hidden" name="insightId" value={i.id} />
                          <input type="hidden" name="status" value="discarded" />
                          <button type="submit" disabled={statusPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                            {tt("Discard")}</button>
                        </form>
                      ) : null}

                      {i.status !== "active" ? (
                        <form action={statusAction} onSubmit={() => setLastAction("status")}>
                          <input type="hidden" name="insightId" value={i.id} />
                          <input type="hidden" name="status" value="active" />
                          <button type="submit" disabled={statusPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                            {tt("Reopen")}</button>
                        </form>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {props.insights.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
            {tt(props.currentStatus === "active"
              ? "No active insights for this filter. New insights are generated every 6 hours from your metrics, or click Refresh insights."
              : `No ${props.currentStatus === "all" ? "" : `${props.currentStatus} `}insights found for this filter.`)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
