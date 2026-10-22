"use client";

import { useActionState, useState } from "react";
import type {
  AdImpressionItem,
  AdSurface,
  AdvertiserBreakdownItem,
} from "@athena/core/commerce";
import {
  captureSponsoredAdsAction,
  recordAdImpressionAction,
  deleteAdImpressionAction,
} from "@/app/(app)/ads/actions";
import type { ActionState } from "@/lib/action-state";

const idle: ActionState = { ok: false };

interface Props {
  impressions: AdImpressionItem[];
  advertiserBreakdown: AdvertiserBreakdownItem[];
  advertisers: string[];
  prompts: { id: string; text: string }[];
  surfaceCounts: Record<AdSurface, number>;
  canWrite: boolean;
}

const SURFACE_BADGE: Record<AdSurface, string> = {
  chatgpt: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  ai_mode: "bg-blue-50 text-blue-700 border border-blue-200",
  ai_overview: "bg-purple-50 text-purple-700 border border-purple-200",
};

const SURFACE_LABELS: Record<AdSurface, string> = {
  chatgpt: "ChatGPT",
  ai_mode: "AI Mode",
  ai_overview: "AI Overview",
};

export function AdsCaptureView(props: Props) {
  const [surfaceFilter, setSurfaceFilter] = useState<"all" | AdSurface>("all");
  const [advertiserFilter, setAdvertiserFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [lastKey, setLastKey] = useState<string>("scan");

  const [scanState, scanAct, scanPending] = useActionState(captureSponsoredAdsAction, idle);
  const [recordState, recordAct, recordPending] = useActionState(recordAdImpressionAction, idle);
  const [deleteState, deleteAct, deletePending] = useActionState(deleteAdImpressionAction, idle);

  const stateMap: Record<string, ActionState> = {
    scan: scanState,
    record: recordState,
    delete: deleteState,
  };
  const ordered = [
    stateMap[lastKey] ?? idle,
    ...Object.entries(stateMap)
      .filter(([k]) => k !== lastKey)
      .map(([, v]) => v),
  ];
  const errorMsg = ordered.find((s) => s.error)?.error;
  const infoMsg = ordered.find((s) => s.message)?.message;

  const filtered = props.impressions.filter((item) => {
    if (surfaceFilter !== "all" && item.surface !== surfaceFilter) return false;
    if (advertiserFilter !== "all" && item.advertiser !== advertiserFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${item.advertiser} ${item.adText} ${item.promptText ?? ""} ${item.surfaceLabel}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
            <button
              type="button"
              data-testid="ads-surface-all"
              onClick={() => setSurfaceFilter("all")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                surfaceFilter === "all" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              All Surfaces ({props.impressions.length})
            </button>
            <button
              type="button"
              data-testid="ads-surface-chatgpt"
              onClick={() => setSurfaceFilter("chatgpt")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                surfaceFilter === "chatgpt" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              ChatGPT ({props.surfaceCounts.chatgpt})
            </button>
            <button
              type="button"
              data-testid="ads-surface-ai_mode"
              onClick={() => setSurfaceFilter("ai_mode")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                surfaceFilter === "ai_mode" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              AI Mode ({props.surfaceCounts.ai_mode})
            </button>
            <button
              type="button"
              data-testid="ads-surface-ai_overview"
              onClick={() => setSurfaceFilter("ai_overview")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                surfaceFilter === "ai_overview" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              AI Overview ({props.surfaceCounts.ai_overview})
            </button>
          </div>

          <select
            value={advertiserFilter}
            onChange={(e) => setAdvertiserFilter(e.target.value)}
            aria-label="Filter by advertiser"
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700"
          >
            <option value="all">All Advertisers ({props.advertisers.length})</option>
            {props.advertisers.map((adv) => (
              <option key={adv} value={adv}>
                {adv}
              </option>
            ))}
          </select>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search advertiser, ad copy, or prompt…"
            className="w-56 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-800"
          />
        </div>

        {props.canWrite ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              + Record ad capture
            </button>
            <form action={scanAct} onSubmit={() => setLastKey("scan")}>
              <button
                type="submit"
                disabled={scanPending}
                className="btn-primary !px-3 !py-1.5 text-xs"
              >
                {scanPending ? "Scanning…" : "Scan AI surfaces for ads"}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {/* Banners */}
      {errorMsg ? (
        <div
          role="alert"
          data-testid="ads-error-banner"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {errorMsg}
        </div>
      ) : null}
      {!errorMsg && infoMsg ? (
        <div
          role="status"
          data-testid="ads-status-banner"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
        >
          {infoMsg}
        </div>
      ) : null}

      {/* Expandable Record Ad Form */}
      {showAddForm && props.canWrite ? (
        <form
          action={recordAct}
          onSubmit={() => setLastKey("record")}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Record Sponsored Ad Capture (ChatGPT / AI Mode / AI Overview)
            </div>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-gray-400">
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-5">
            <select
              name="surface"
              defaultValue="chatgpt"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
            >
              <option value="chatgpt">ChatGPT Sponsored</option>
              <option value="ai_mode">Google AI Mode</option>
              <option value="ai_overview">Google AI Overview</option>
            </select>
            <input
              name="advertiser"
              required
              placeholder="Advertiser (e.g. Framer, Sketch)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <select
              name="promptId"
              defaultValue={props.prompts[0]?.id ?? "none"}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
            >
              <option value="none">No linked prompt</option>
              {props.prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.text}
                </option>
              ))}
            </select>
            <input
              name="adText"
              required
              placeholder="Sponsored ad copy shown in response…"
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <button type="submit" disabled={recordPending} className="btn-primary !px-3 !py-2 text-xs">
              {recordPending ? "Saving…" : "Save Ad Capture"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Advertiser Share of Sponsored Voice */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Advertiser Share of Sponsored Voice
            </div>
            <div className="text-xs text-gray-400">
              Share of captured sponsored placements across ChatGPT, Google AI Mode, and AI Overview
            </div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {props.advertiserBreakdown.map((adv) => (
            <div
              key={adv.advertiser}
              className={`rounded-lg border p-3 ${
                adv.isOwn ? "border-brand-200 bg-brand-50/40" : "border-gray-100 bg-gray-50/60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-900">{adv.advertiser}</span>
                <span
                  className={`badge text-[10px] ${
                    adv.isOwn ? "bg-brand-100 text-brand-700" : "bg-white text-gray-600"
                  }`}
                >
                  {adv.isOwn ? "Own Brand" : "Competitor"}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-lg font-bold text-gray-900">{adv.sharePct.toFixed(1)}%</span>
                <span className="text-[11px] text-gray-500">
                  {adv.impressions} {adv.impressions === 1 ? "capture" : "captures"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {adv.surfaces.map((s) => (
                  <span key={s} className={`badge text-[10px] ${SURFACE_BADGE[s]}`}>
                    {SURFACE_LABELS[s]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Captured Sponsored Ads Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="table-base" data-testid="ads-captures-table">
          <thead>
            <tr>
              <th>AI Surface</th>
              <th>Advertiser</th>
              <th>Sponsored Ad Copy</th>
              <th>Trigger Prompt</th>
              <th>Captured</th>
              {props.canWrite ? <th className="text-right">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className={`badge ${SURFACE_BADGE[a.surface]}`}>{a.surfaceLabel}</span>
                </td>
                <td>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-gray-900">{a.advertiser}</span>
                    {a.isOwn ? (
                      <span className="badge bg-brand-50 text-[10px] text-brand-700">Own</span>
                    ) : null}
                  </div>
                </td>
                <td className="max-w-md text-xs text-gray-700">{a.adText}</td>
                <td className="text-xs text-gray-500">
                  {a.promptText ? (
                    <div>
                      <div className="font-medium text-gray-700">&ldquo;{a.promptText}&rdquo;</div>
                      {a.topicName ? (
                        <span className="text-[10px] text-gray-400">Topic: {a.topicName}</span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-gray-400">Category benchmark query</span>
                  )}
                </td>
                <td className="font-mono text-xs text-gray-400">
                  {new Date(a.seenAt).toISOString().slice(0, 10)}
                </td>
                {props.canWrite ? (
                  <td className="text-right">
                    <form action={deleteAct} onSubmit={() => setLastKey("delete")}>
                      <input type="hidden" name="impressionId" value={a.id} />
                      <button
                        type="submit"
                        disabled={deletePending}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
