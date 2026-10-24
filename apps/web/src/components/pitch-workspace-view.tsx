"use client";
import { useTranslations } from "@/components/locale-provider";


import Link from "next/link";
import { useActionState, useState } from "react";
import type { PitchItem, PitchUsageSummary } from "@athena/core/pitches";
import type { ActionState } from "@/lib/action-state";
import {
  createPitchAction,
  deletePitchAction,
  regeneratePitchRewriteAction,
} from "@/app/(app)/pitches/actions";

const idle: ActionState = { ok: false };

export function PitchWorkspaceView({
  pitches,
  usage,
  defaultGroupId,
  defaultGroupName,
}: {
  pitches: PitchItem[];
  usage: PitchUsageSummary;
  defaultGroupId: string;
  defaultGroupName: string;
}) {
  const tt = useTranslations();
  const [showWizard, setShowWizard] = useState(false);
  const [wizardKind, setWizardKind] = useState<"visibility" | "content">("visibility");
  const [kindFilter, setKindFilter] = useState<"all" | "visibility" | "content">("all");
  const [selectedPitchId, setSelectedPitchId] = useState<string>(pitches[0]?.id ?? "");

  const [createState, createFormAction, createPending] = useActionState(createPitchAction, idle);
  const [rewriteState, rewriteFormAction, rewritePending] = useActionState(
    regeneratePitchRewriteAction,
    idle,
  );
  const [deleteState, deleteFormAction, deletePending] = useActionState(deletePitchAction, idle);

  const banner = [createState, rewriteState, deleteState].find((s) => s.message || s.error);

  const filteredPitches = pitches.filter((p) =>
    kindFilter === "all" ? true : p.kind === kindFilter,
  );
  const activePitch =
    filteredPitches.find((p) => p.id === selectedPitchId) ??
    filteredPitches[0] ??
    pitches[0] ??
    null;

  const usagePct = Math.min(
    100,
    Math.round((usage.usedThisMonth / Math.max(1, usage.monthlyLimit)) * 100),
  );

  return (
    <div className="space-y-6 p-6">
      {/* Top Action & Agency Group Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {tt("Prospect Pitch Generator & Agency Portfolio Hub")}</div>
          <div className="text-xs text-gray-500">
            {tt("Generate shareable AI visibility & content rewrite decks from any prospect URL, or manage multi-brand groups and shared credit pools.")}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/group/${defaultGroupId}`}
            className="btn-secondary !px-3.5 !py-2 text-xs font-medium"
          >
            {tt("🏢 Group Dashboard & Billing (")}{defaultGroupName})
          </Link>
          <button
            type="button"
            onClick={() => setShowWizard((v) => !v)}
            className="btn-primary !px-4 !py-2 text-xs font-semibold"
          >
            {tt(showWizard ? "Close Pitch Wizard" : "+ Create Pitch")}
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner?.message ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800"
        >
          ✓ {tt(banner.message)}
        </div>
      ) : null}
      {banner?.error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
        >
          ⚠ {tt(banner.error)}
        </div>
      ) : null}

      {/* Monthly Quota & Usage Card */}
      <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-brand-800">
            {tt("Pitch usage this month:")}{tt(" ")}
            <strong className="font-mono text-sm">
              {usage.usedThisMonth} / {usage.monthlyLimit}
            </strong>{tt(" ")}
            <span className="ml-1 rounded bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-brand-700">
              {tt(usage.plan)} {tt(" plan")}</span>
          </div>
          <div className="flex items-center gap-3 text-brand-700">
            <span>
              <strong>{usage.remaining}</strong> {tt(" pitch slot(s) remaining this month")}</span>
            <Link href="/settings/billing" className="font-semibold underline">
              {tt("Upgrade for higher quota →")}</Link>
          </div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-brand-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${usagePct}%` }}
          />
        </div>
      </div>

      {/* Create Pitch Wizard */}
      {showWizard ? (
        <form
          action={createFormAction}
          className="space-y-4 rounded-xl border border-brand-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {tt("Create Prospect Pitch Report Wizard")}</h2>
              <p className="text-xs text-gray-500">
                {tt("Enter a prospect website URL to synthesize a shareable AI search visibility audit or before/after AEO content rewrite deck.")}</p>
            </div>
            <span className="badge bg-brand-50 text-xs text-brand-700">{tt("Step 1–3 Wizard")}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {tt("Step 1: Prospect Website URL *")}</label>
              <input
                type="text"
                name="websiteUrl"
                required
                placeholder={tt("https://linear.app")}
                className="input-base w-full text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {tt("Prospect Brand Name (auto-detected if blank)")}</label>
              <input
                type="text"
                name="brandName"
                placeholder={tt("Linear")}
                className="input-base w-full text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {tt("Industry / Category")}</label>
              <input
                type="text"
                name="industry"
                placeholder={tt("Product Management & Issue Tracking")}
                className="input-base w-full text-xs"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700">
              {tt("Step 2: Select Pitch Deck Mode")}</label>
            <div className="grid gap-3 md:grid-cols-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs transition ${
                  wizardKind === "visibility"
                    ? "border-brand-500 bg-brand-50/40"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value="visibility"
                  checked={wizardKind === "visibility"}
                  onChange={() => setWizardKind("visibility")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-gray-900">
                    {tt("AI Search Visibility Audit Pitch (/report/pitch_...)")}</div>
                  <div className="mt-0.5 text-gray-500">
                    {tt("Benchmarks the prospect's Mention Rate, Citation Authority, Competitor Share of Voice, and Top Cited Domains across ChatGPT, Perplexity & Claude.")}</div>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs transition ${
                  wizardKind === "content"
                    ? "border-purple-500 bg-purple-50/40"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value="content"
                  checked={wizardKind === "content"}
                  onChange={() => setWizardKind("content")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-gray-900">
                    {tt("AEO Content Rewrite Pitch (/report/content/cpitch_...)")}</div>
                  <div className="mt-0.5 text-gray-500">
                    {tt("Generates a side-by-side Before vs. After page rewrite with inverted-pyramid TL;DR blocks, quantitative benchmarks, and copy-ready FAQPage JSON-LD.")}</div>
                </div>
              </label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {tt("Step 3: Target Page URL for Content Rewrite (optional)")}</label>
              <input
                type="text"
                name="targetPageUrl"
                placeholder={tt("https://linear.app/features")}
                className="input-base w-full text-xs"
              />
              <label className="mb-1 mt-3 block text-xs font-medium text-gray-700">
                {tt("Target AI Search Prompts (comma or newline separated)")}</label>
              <textarea
                name="targetPrompts"
                rows={2}
                placeholder={tt("best issue tracking software for enterprise engineering teams 2026")}
                className="input-base w-full text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {tt("Prospect's Existing Page Copy (Before Rewrite — optional)")}</label>
              <textarea
                name="existingCopy"
                rows={5}
                placeholder={tt("Paste the prospect's current hero/feature copy here to generate an answer-first AEO rewrite comparison...")}
                className="input-base w-full text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setShowWizard(false)}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              {tt("Cancel")}</button>
            <button
              type="submit"
              disabled={createPending || usage.remaining <= 0}
              className="btn-primary !px-4 !py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {tt(createPending ? "Generating Pitch Deck..." : "Generate Shareable Pitch Report")}
            </button>
          </div>
        </form>
      ) : null}

      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {(
            [
              { key: "all", label: `All Pitches (${pitches.length})` },
              {
                key: "visibility",
                label: `Visibility Audits (${pitches.filter((p) => p.kind === "visibility").length})`,
              },
              {
                key: "content",
                label: `Content Rewrites (${pitches.filter((p) => p.kind === "content").length})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setKindFilter(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                kindFilter === tab.key
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tt(tab.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Pitches Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="table-base">
          <thead>
            <tr>
              <th>{tt("Prospect Brand")}</th>
              <th>{tt("Kind")}</th>
              <th>{tt("Est. Mention / Citation")}</th>
              <th>{tt("Projected Rewrite Lift")}</th>
              <th>{tt("Public Share Link")}</th>
              <th>{tt("Export")}</th>
              <th className="text-right">{tt("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredPitches.map((p) => {
              const isSelected = activePitch?.id === p.id;
              return (
                <tr
                  key={p.id}
                  onClick={() => setSelectedPitchId(p.id)}
                  className={`cursor-pointer transition ${
                    isSelected ? "bg-brand-50/40" : "hover:bg-gray-50"
                  }`}
                >
                  <td>
                    <div className="font-semibold text-gray-900">{p.brandName}</div>
                    <div className="font-mono text-[11px] text-gray-400">{p.websiteUrl}</div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        p.kind === "content"
                          ? "bg-purple-50 text-purple-700"
                          : "bg-brand-50 text-brand-700"
                      }`}
                    >
                      {tt(p.kind === "content" ? "content rewrite" : "visibility")}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-gray-700">
                    {p.payload.kpis.mentionRatePct.toFixed(1)}% /{tt(" ")}
                    {p.payload.kpis.citationRatePct.toFixed(1)}%
                  </td>
                  <td>
                    <span className="badge bg-emerald-50 font-mono text-xs text-emerald-700">
                      +{p.payload.contentRewrite.projectedCitationLiftPct}{tt("% lift")}</span>
                  </td>
                  <td>
                    <a
                      href={p.sharePath}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs text-brand-600 underline hover:text-brand-800"
                    >
                      {p.sharePath}
                    </a>
                  </td>
                  <td>
                    <a
                      href={`/api/reports/${p.id}/pdf?shareId=${encodeURIComponent(p.shareId)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="btn-secondary !px-2.5 !py-1 text-xs"
                    >
                      {tt("⬇ PDF")}</a>
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedPitchId(p.id)}
                        className="btn-secondary !px-2.5 !py-1 text-xs"
                      >
                        {tt("Inspect Rewrite")}</button>
                      <form action={deleteFormAction}>
                        <input type="hidden" name="pitchId" value={p.id} />
                        <button
                          type="submit"
                          disabled={deletePending}
                          className="btn-secondary !px-2.5 !py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          {tt("Delete")}</button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredPitches.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-gray-400">
                  {tt("No pitches match the selected filter. Click “+ Create Pitch“ to generate a prospect report.")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Selected Pitch — Interactive Content Rewrite Pitch Studio */}
      {activePitch ? (
        <div className="metric-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  {tt("Content Rewrite Pitch Studio — ")}{activePitch.brandName}
                </h3>
                <span className="badge bg-emerald-50 text-xs font-semibold text-emerald-700">
                  +{activePitch.payload.contentRewrite.projectedCitationLiftPct}{tt("% Projected Citation Lift")}</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {tt("Target Page:")}{tt(" ")}
                <span className="font-mono text-brand-600">
                  {activePitch.payload.contentRewrite.targetPageUrl}
                </span>{tt(" ")}
                {tt("· Public Deck:")}{tt(" ")}
                <a href={activePitch.sharePath} className="font-mono text-brand-600 underline">
                  {activePitch.sharePath}
                </a>
              </p>
            </div>
            <a
              href={activePitch.sharePath}
              className="btn-primary !px-3.5 !py-1.5 text-xs font-medium"
            >
              {tt("Open Public Pitch View →")}</a>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-red-100 bg-red-50/30 p-3.5">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
                {tt("Before (Prospect's Existing Copy)")}</div>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                {activePitch.payload.contentRewrite.beforeCopy}
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3.5">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                {tt("After (AEO Answer-First Rewrite for AI Citations)")}</div>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800">
                {activePitch.payload.contentRewrite.afterCopy}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Customize & Regenerate Content Rewrite Form */}
            <form
              action={rewriteFormAction}
              className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3.5"
            >
              <input type="hidden" name="pitchId" value={activePitch.id} />
              <div className="text-xs font-semibold text-gray-900">
                {tt("Customize & Regenerate Content Rewrite Pitch")}</div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">
                  {tt("Target Prospect URL")}</label>
                <input
                  type="text"
                  name="targetPageUrl"
                  defaultValue={activePitch.payload.contentRewrite.targetPageUrl}
                  key={`url-${activePitch.id}`}
                  className="input-base w-full text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">
                  {tt("Focus High-Intent Prompt")}</label>
                <input
                  type="text"
                  name="focusPrompt"
                  defaultValue={activePitch.payload.contentRewrite.focusPrompt}
                  key={`prompt-${activePitch.id}`}
                  className="input-base w-full text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">
                  {tt("Prospect's Original Copy")}</label>
                <textarea
                  name="existingCopy"
                  rows={2}
                  defaultValue={activePitch.payload.contentRewrite.beforeCopy}
                  key={`copy-${activePitch.id}`}
                  className="input-base w-full text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={rewritePending}
                className="btn-secondary w-full !py-1.5 text-xs font-semibold"
              >
                {tt(rewritePending
                  ? "Regenerating AEO Rewrite..."
                  : "✨ Regenerate Content Rewrite Pitch")}
              </button>
            </form>

            {/* Recommended FAQPage JSON-LD Schema */}
            <div className="rounded-lg border border-gray-100 bg-gray-900 p-3.5 text-gray-100">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-300">
                {tt("Copy-Ready FAQPage JSON-LD Schema")}</div>
              <pre className="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-300">
                {activePitch.payload.contentRewrite.jsonLdSchema}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
