"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type {
  ReportChartKey,
  ScheduledReportItem,
} from "@athena/core/reports";
import {
  createReportAction,
  updateReportAction,
  sendReportNowAction,
  deleteReportAction,
} from "@/app/(app)/reports/actions";
import type { ActionState } from "@/lib/action-state";

const idle: ActionState = { ok: false };

const CHART_MODULES: {
  key: ReportChartKey;
  label: string;
  category: string;
  description: string;
}[] = [
  {
    key: "mention_rate",
    label: "Brand Mention Rate (30d)",
    category: "visibility",
    description: "Daily % of AI responses mentioning your brand vs top competitor",
  },
  {
    key: "citation_rate",
    label: "Citation Rate & Authority Trend",
    category: "visibility",
    description: "Daily % of AI responses citing your domain URLs as primary sources",
  },
  {
    key: "share_of_voice",
    label: "Share of Voice vs Competitors",
    category: "visibility",
    description: "Relative mention share across all tracked AI search engines",
  },
  {
    key: "ai_search_value",
    label: "Estimated AI Search Traffic Value",
    category: "visibility",
    description: "Monthly equivalent organic/paid search value from AI answer citations",
  },
  {
    key: "top_sources",
    label: "Top Cited Domains & Authority Pages",
    category: "sources",
    description: "Most frequently cited third-party and own-brand domains",
  },
  {
    key: "prompt_gaps",
    label: "High-Volume Prompt Gaps",
    category: "content",
    description: "Prompts where competitors are mentioned but your brand is omitted",
  },
  {
    key: "content_proposals",
    label: "AI Content Proposals & Briefs",
    category: "content",
    description: "Recommended AEO articles, briefs, and target URLs from Content Hub",
  },
  {
    key: "site_health_summary",
    label: "AI Crawler Accessibility & Sitemap",
    category: "technical",
    description: "OAI-SearchBot, Claude-SearchBot & PerplexityBot access health",
  },
];

interface Props {
  reports: ScheduledReportItem[];
  siteDomain: string;
  canWrite: boolean;
}

export function ReportBuilderView(props: Props) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(props.reports[0]?.id ?? null);
  const [lastKey, setLastKey] = useState<string>("send");

  const [createState, createAct, createPending] = useActionState(createReportAction, idle);
  const [updateState, updateAct, updatePending] = useActionState(updateReportAction, idle);
  const [sendState, sendAct, sendPending] = useActionState(sendReportNowAction, idle);
  const [deleteState, deleteAct, deletePending] = useActionState(deleteReportAction, idle);

  const stateMap: Record<string, ActionState> = {
    create: createState,
    update: updateState,
    send: sendState,
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

  const selectedReport =
    props.reports.find((r) => r.id === selectedId) ?? props.reports[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            Scheduled Reports &amp; Public Share Links ({props.reports.length})
          </div>
          <div className="text-xs text-gray-500">
            Compose chart sets, schedule automated Email &amp; Slack weekly digests, export PDFs, and share live AI Search or Content Proposal reports
          </div>
        </div>
        {props.canWrite ? (
          <button
            type="button"
            data-testid="report-new-btn"
            onClick={() => setShowCreateForm((v) => !v)}
            className="btn-primary !px-3.5 !py-1.5 text-xs"
          >
            + New report
          </button>
        ) : null}
      </div>

      {/* Banners */}
      {errorMsg ? (
        <div
          role="alert"
          data-testid="reports-error-banner"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {errorMsg}
        </div>
      ) : null}
      {!errorMsg && infoMsg ? (
        <div
          role="status"
          data-testid="reports-status-banner"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
        >
          {infoMsg}
        </div>
      ) : null}

      {/* Expandable Create Report Builder */}
      {showCreateForm && props.canWrite ? (
        <form
          action={createAct}
          onSubmit={() => setLastKey("create")}
          data-testid="report-create-form"
          className="rounded-xl border border-gray-200 bg-white p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Create Scheduled Report &amp; Public Share Link
            </div>
            <button type="button" onClick={() => setShowCreateForm(false)} className="text-xs text-gray-400">
              Close
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">Report Name</label>
              <input
                name="name"
                required
                placeholder="e.g. Executive Weekly AI Search Digest"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Report Type</label>
              <select
                name="reportType"
                defaultValue="ai_search"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
              >
                <option value="ai_search">AI Search Visibility Report (/report/...)</option>
                <option value="content_proposal">Content Proposal Report (/report/content/...)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Delivery Cadence</label>
              <select
                name="cadence"
                defaultValue="weekly"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
              >
                <option value="daily">Daily · 09:00 UTC</option>
                <option value="weekly">Weekly · Mon 09:00 UTC</option>
                <option value="biweekly">Biweekly · Mon 09:00 UTC</option>
                <option value="monthly">Monthly · 1st of month</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Email Recipients (comma-separated)
              </label>
              <input
                name="recipients"
                defaultValue={`leadership@${props.siteDomain}, marketing@${props.siteDomain}`}
                placeholder="exec@company.com, seo@company.com"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Slack Weekly Report Channel
              </label>
              <input
                name="slackChannel"
                defaultValue="#aeo-weekly"
                placeholder="#aeo-weekly"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-gray-600">
              Chart Composition Modules (Select charts to include in PDF, Slack &amp; Public Share Link)
            </label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {CHART_MODULES.map((m, idx) => (
                <label
                  key={m.key}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2.5 text-xs hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    name="charts"
                    value={m.key}
                    defaultChecked={idx < 4}
                    className="mt-0.5 rounded border-gray-300"
                  />
                  <div>
                    <div className="font-semibold text-gray-800">{m.label}</div>
                    <div className="text-[11px] text-gray-400">{m.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={createPending} className="btn-primary !px-4 !py-2 text-xs">
              {createPending ? "Creating…" : "Create Report & Generate Share Link"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Scheduled Reports Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="table-base" data-testid="reports-table">
          <thead>
            <tr>
              <th>Report Name</th>
              <th>Type</th>
              <th>Chart Modules</th>
              <th>Cadence &amp; Slack</th>
              <th>Recipients</th>
              <th>Public Share Link</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.reports.map((r) => {
              const isSelected = selectedReport?.id === r.id;
              return (
                <tr
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`cursor-pointer transition ${isSelected ? "bg-brand-50/40" : ""}`}
                >
                  <td>
                    <div className="font-semibold text-gray-900">{r.name}</div>
                    <div className="text-[11px] text-gray-400">
                      {r.lastSentAt
                        ? `Last sent ${new Date(r.lastSentAt).toISOString().slice(0, 10)}`
                        : "Never dispatched"}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        r.reportType === "content_proposal"
                          ? "bg-purple-50 text-purple-700"
                          : "bg-brand-50 text-brand-700"
                      }`}
                    >
                      {r.reportType === "content_proposal" ? "Content Proposal" : "AI Search Report"}
                    </span>
                  </td>
                  <td>
                    <span className="font-mono text-xs font-semibold text-gray-800">
                      {r.charts.length} charts
                    </span>
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="badge bg-gray-100 text-gray-700">{r.cadence}</span>
                      {r.slackChannel ? (
                        <span className="badge bg-emerald-50 font-mono text-emerald-700">
                          Slack {r.slackChannel}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="text-xs text-gray-600">
                    {r.recipients.length} {r.recipients.length === 1 ? "email" : "emails"}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link
                      href={r.sharePath}
                      className="font-mono text-xs text-brand-600 underline hover:text-brand-800"
                    >
                      {r.sharePath}
                    </Link>
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-2">
                      {props.canWrite ? (
                        <form action={sendAct} onSubmit={() => setLastKey("send")}>
                          <input type="hidden" name="reportId" value={r.id} />
                          <button
                            type="submit"
                            disabled={sendPending}
                            className="btn-secondary !px-2.5 !py-1 text-xs"
                          >
                            Send now
                          </button>
                        </form>
                      ) : null}
                      <a
                        href={`/api/reports/${r.id}/pdf?shareId=${encodeURIComponent(r.shareId)}`}
                        className="btn-secondary !px-2.5 !py-1 text-xs"
                      >
                        PDF
                      </a>
                      {props.canWrite ? (
                        <form action={deleteAct} onSubmit={() => setLastKey("delete")}>
                          <input type="hidden" name="reportId" value={r.id} />
                          <button
                            type="submit"
                            disabled={deletePending}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Selected Report Chart Composition Studio */}
      {selectedReport && props.canWrite ? (
        <form
          key={selectedReport.id}
          action={updateAct}
          onSubmit={() => setLastKey("update")}
          data-testid="report-composition-studio"
          className="rounded-xl border border-gray-200 bg-white p-5 space-y-4"
        >
          <input type="hidden" name="reportId" value={selectedReport.id} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                Chart Composition &amp; Schedule Studio
              </div>
              <div className="text-sm font-bold text-gray-900">{selectedReport.name}</div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={selectedReport.sharePath} className="btn-secondary !px-3 !py-1.5 text-xs">
                Open Public Share View →
              </Link>
              <a
                href={`/api/reports/${selectedReport.id}/pdf?shareId=${encodeURIComponent(selectedReport.shareId)}`}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                ⬇ Download PDF
              </a>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">Report Title</label>
              <input
                name="name"
                defaultValue={selectedReport.name}
                required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Report Template</label>
              <select
                name="reportType"
                defaultValue={selectedReport.reportType}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
              >
                <option value="ai_search">AI Search Visibility Report</option>
                <option value="content_proposal">Content Proposal Report</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Schedule Cadence</label>
              <select
                name="cadence"
                defaultValue={selectedReport.cadence}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Email Recipients (comma-separated)
              </label>
              <input
                name="recipients"
                defaultValue={selectedReport.recipients.join(", ")}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Slack Weekly Digest Channel
              </label>
              <input
                name="slackChannel"
                defaultValue={selectedReport.slackChannel ?? ""}
                placeholder="#aeo-executive"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-gray-600">
              Active Chart Modules ({selectedReport.charts.length} selected)
            </label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {CHART_MODULES.map((m) => (
                <label
                  key={m.key}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-2.5 text-xs hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    name="charts"
                    value={m.key}
                    defaultChecked={selectedReport.charts.includes(m.key)}
                    className="mt-0.5 rounded border-gray-300"
                  />
                  <div>
                    <div className="font-semibold text-gray-800">{m.label}</div>
                    <div className="text-[11px] text-gray-400">{m.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={updatePending} className="btn-primary !px-4 !py-2 text-xs">
              {updatePending ? "Saving…" : "Save Report Configuration"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
