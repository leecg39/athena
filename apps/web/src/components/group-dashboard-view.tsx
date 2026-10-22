"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { GroupDashboardData } from "@athena/core/pitches";
import type { ActionState } from "@/lib/action-state";
import {
  allocateGroupCreditsAction,
  assignWebsiteGroupAction,
  createGroupAction,
  createGroupSavedViewAction,
  deleteGroupSavedViewAction,
} from "@/app/(app)/group/[id]/actions";

const idle: ActionState = { ok: false };

export function GroupDashboardView({
  data,
  initialTab = "dashboard",
}: {
  data: GroupDashboardData;
  initialTab?: "dashboard" | "billing";
}) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "billing">(initialTab);
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [domainFilter, setDomainFilter] = useState("");

  const [createGroupState, createGroupFormAction, createGroupPending] = useActionState(
    createGroupAction,
    idle,
  );
  const [assignSiteState, assignSiteFormAction, assignSitePending] = useActionState(
    assignWebsiteGroupAction,
    idle,
  );
  const [allocCreditsState, allocCreditsFormAction, allocCreditsPending] = useActionState(
    allocateGroupCreditsAction,
    idle,
  );
  const [createViewState, createViewFormAction, createViewPending] = useActionState(
    createGroupSavedViewAction,
    idle,
  );
  const [deleteViewState, deleteViewFormAction, deleteViewPending] = useActionState(
    deleteGroupSavedViewAction,
    idle,
  );

  const banner = [
    createGroupState,
    assignSiteState,
    allocCreditsState,
    createViewState,
    deleteViewState,
  ].find((s) => s.message || s.error);

  const visibleMemberSites = domainFilter.trim()
    ? data.memberWebsites.filter(
        (w) =>
          w.domain.toLowerCase().includes(domainFilter.trim().toLowerCase()) ||
          w.name.toLowerCase().includes(domainFilter.trim().toLowerCase()),
      )
    : data.memberWebsites;

  const unassignedOrOtherSites = data.availableWebsites.filter(
    (s) => s.groupId !== data.group.id,
  );

  return (
    <div className="space-y-6 p-6">
      {/* Top Group Switcher & Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Portfolio Groups:
          </span>
          {data.allGroups.map((g) => (
            <Link
              key={g.id}
              href={`/group/${g.id}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                g.id === data.group.id
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {g.name} ({g.websiteCount})
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setShowNewGroupForm((v) => !v)}
            className="btn-secondary !px-3 !py-1.5 text-xs"
          >
            {showNewGroupForm ? "Close" : "+ New Group"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "dashboard"
                ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            📊 Group Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("billing")}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "billing"
                ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            💳 Group Billing &amp; Shared Credits ({data.billing.groupSharedBalance.toLocaleString()})
          </button>
          <Link href="/pitches" className="btn-secondary !px-3 !py-1.5 text-xs">
            ← Pitch Workspace
          </Link>
        </div>
      </div>

      {/* Create New Group Form */}
      {showNewGroupForm ? (
        <form
          action={createGroupFormAction}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-brand-200 bg-white p-4 shadow-sm"
        >
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              New Brand Portfolio Group Name
            </label>
            <input
              type="text"
              name="name"
              required
              placeholder="e.g. North America Enterprise Portfolio"
              className="input-base w-full text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={createGroupPending}
            className="btn-primary !px-4 !py-2 text-xs font-semibold"
          >
            {createGroupPending ? "Creating..." : "Create Group"}
          </button>
        </form>
      ) : null}

      {/* Feedback Banner */}
      {banner?.message ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800"
        >
          ✓ {banner.message}
        </div>
      ) : null}
      {banner?.error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
        >
          ⚠ {banner.error}
        </div>
      ) : null}

      {activeTab === "dashboard" ? (
        <div className="space-y-6">
          {/* Group Executive KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="metric-card">
              <div className="text-xs text-gray-400">Websites in Group</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">{data.kpis.websiteCount}</div>
              <div className="mt-1 text-xs text-gray-500">
                {data.kpis.totalActivePrompts} tracked prompts · {data.kpis.totalResponses} responses
              </div>
            </div>
            <div className="metric-card">
              <div className="text-xs text-gray-400">Group Share of Voice</div>
              <div className="mt-1 text-2xl font-bold text-brand-700">
                {data.kpis.groupSovPct.toFixed(1)}%
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Weighted portfolio SOV across AI engines
              </div>
            </div>
            <div className="metric-card">
              <div className="text-xs text-gray-400">Group Mention / Citation Rate</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {data.kpis.groupMentionRatePct.toFixed(1)}%{" "}
                <span className="text-sm font-normal text-gray-400">
                  / {data.kpis.groupCitationRatePct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Aggregated across member brand workspaces
              </div>
            </div>
            <div className="metric-card">
              <div className="text-xs text-gray-400">Dollar Value (Est. Monthly)</div>
              <div className="mt-1 text-2xl font-bold text-emerald-700">
                ${data.kpis.totalEstimatedValueUsd.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Shared Credits: {data.billing.groupSharedBalance.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Group Saved Views & Domain Filter */}
          <div className="metric-card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-700">Group Saved Views:</span>
                <button
                  type="button"
                  onClick={() => setDomainFilter("")}
                  className={`badge cursor-pointer ${
                    domainFilter === ""
                      ? "bg-brand-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  All Member Websites
                </button>
                {data.savedViews.map((v) => {
                  const vf = String(v.filters.domainFilter ?? "");
                  return (
                    <div key={v.id} className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDomainFilter(vf)}
                        className={`badge cursor-pointer ${
                          domainFilter === vf && vf !== ""
                            ? "bg-brand-600 text-white"
                            : "bg-brand-50 text-brand-700 hover:bg-brand-100"
                        }`}
                      >
                        {v.name} {vf ? `(${vf})` : ""}
                      </button>
                      <form action={deleteViewFormAction}>
                        <input type="hidden" name="groupId" value={data.group.id} />
                        <input type="hidden" name="viewId" value={v.id} />
                        <button
                          type="submit"
                          disabled={deleteViewPending}
                          title={`Delete view ${v.name}`}
                          className="text-xs text-gray-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>

              <form action={createViewFormAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="groupId" value={data.group.id} />
                <input
                  type="text"
                  name="domainFilter"
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  placeholder="Filter brand/domain..."
                  className="input-base !py-1 text-xs"
                />
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Save view name..."
                  className="input-base !py-1 text-xs"
                />
                <button
                  type="submit"
                  disabled={createViewPending}
                  className="btn-secondary !px-3 !py-1 text-xs"
                >
                  + Save Group View
                </button>
              </form>
            </div>
          </div>

          {/* Share of Voice by Brand & Competitors */}
          <div className="metric-card">
            <div className="mb-3 text-sm font-semibold text-gray-900">
              Share of Voice by Brand Across Portfolio
            </div>
            <div className="space-y-2.5">
              {data.competitorSovRollup.map((c) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span
                    className={`w-48 truncate text-xs ${
                      c.isOwn ? "font-semibold text-brand-700" : "text-gray-600"
                    }`}
                  >
                    {c.isOwn ? `${c.name} (Portfolio)` : c.name}
                  </span>
                  <div className="h-2.5 flex-1 rounded-full bg-gray-100">
                    <div
                      className={`h-2.5 rounded-full ${c.isOwn ? "bg-brand-600" : "bg-gray-300"}`}
                      style={{ width: `${Math.min(100, Math.max(4, c.sovPct))}%` }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono text-xs font-medium">
                    {c.sovPct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Member Websites Table & Portfolio Assignment */}
          <div className="metric-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Member Websites in &ldquo;{data.group.name}&rdquo;
                </h3>
                <p className="text-xs text-gray-500">
                  Per-website AI search performance and portfolio assignment controls.
                </p>
              </div>

              {unassignedOrOtherSites.length > 0 ? (
                <form action={assignSiteFormAction} className="flex items-center gap-2">
                  <input type="hidden" name="groupId" value={data.group.id} />
                  <input type="hidden" name="currentGroupId" value={data.group.id} />
                  <select name="websiteId" className="input-base !py-1.5 text-xs">
                    {unassignedOrOtherSites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.domain})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={assignSitePending}
                    className="btn-primary !px-3 !py-1.5 text-xs"
                  >
                    + Add Website to Group
                  </button>
                </form>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Brand Workspace</th>
                    <th>Domain</th>
                    <th>Prompts</th>
                    <th>AI Responses</th>
                    <th>Mention Rate</th>
                    <th>Citation Rate</th>
                    <th>SOV</th>
                    <th>Est. Value</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMemberSites.map((w) => (
                    <tr key={w.id}>
                      <td className="font-semibold text-gray-900">{w.name}</td>
                      <td className="font-mono text-xs text-gray-500">{w.domain}</td>
                      <td className="font-mono text-xs">{w.activePromptsCount}</td>
                      <td className="font-mono text-xs">{w.totalResponses}</td>
                      <td className="font-mono text-xs font-semibold text-gray-900">
                        {w.mentionRatePct.toFixed(1)}%
                      </td>
                      <td className="font-mono text-xs text-brand-700">
                        {w.citationRatePct.toFixed(1)}%
                      </td>
                      <td className="font-mono text-xs">{w.sovPct.toFixed(1)}%</td>
                      <td className="font-mono text-xs text-emerald-700">
                        ${w.estimatedValueUsd.toLocaleString()}
                      </td>
                      <td className="text-right">
                        <form action={assignSiteFormAction}>
                          <input type="hidden" name="websiteId" value={w.id} />
                          <input type="hidden" name="groupId" value="none" />
                          <input type="hidden" name="currentGroupId" value={data.group.id} />
                          <button
                            type="submit"
                            disabled={assignSitePending}
                            className="btn-secondary !px-2.5 !py-1 text-xs text-gray-600"
                          >
                            Remove from Group
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {visibleMemberSites.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-xs text-gray-400">
                        No websites currently assigned to this group (or matching filter).
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Group Billing & Shared Credit Pool Tab */
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="metric-card border-brand-200 bg-brand-50/30">
              <div className="text-xs font-medium text-brand-700">
                Group Shared Credit Pool ({data.group.name})
              </div>
              <div className="mt-1 text-2xl font-bold text-brand-900">
                {data.billing.groupSharedBalance.toLocaleString()} credits
              </div>
              <div className="mt-1 text-xs text-brand-700">
                Shared across {data.kpis.websiteCount} member website(s) in this group
              </div>
            </div>

            <div className="metric-card">
              <div className="text-xs text-gray-400">Organization Unallocated Pool</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {data.billing.orgUnallocatedBalance.toLocaleString()} credits
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Available to allocate to portfolio groups
              </div>
            </div>

            <div className="metric-card">
              <div className="text-xs text-gray-400">Group Consumed Credits (Recent)</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {data.billing.totalGroupConsumedCredits.toLocaleString()} credits
              </div>
              <div className="mt-1 text-xs text-gray-500">
                1 credit = 1 collected AI response across member sites
              </div>
            </div>
          </div>

          {/* Shared Credit Allocation Form */}
          <form
            action={allocCreditsFormAction}
            className="space-y-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
          >
            <input type="hidden" name="groupId" value={data.group.id} />
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Allocate or Rebalance Shared Group Credits
              </h3>
              <p className="text-xs text-gray-500">
                Atomically transfer credits between the Organization unallocated pool and{" "}
                <strong>{data.group.name}</strong>&apos;s shared credit pool.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Transfer Direction
                </label>
                <select name="direction" className="input-base w-full text-xs">
                  <option value="to_group">
                    Organization Pool → Group Shared Pool ({data.group.name})
                  </option>
                  <option value="to_org">
                    Group Shared Pool ({data.group.name}) → Organization Pool
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Credit Amount *
                </label>
                <input
                  type="number"
                  name="amount"
                  min={1}
                  max={100000}
                  defaultValue={50}
                  required
                  className="input-base w-full text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Allocation Note / Budget Code
                </label>
                <input
                  type="text"
                  name="reason"
                  placeholder="e.g. Monthly client retainer shared pool"
                  className="input-base w-full text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={allocCreditsPending}
                className="btn-primary !px-4 !py-2 text-xs font-semibold"
              >
                {allocCreditsPending ? "Transferring Credits..." : "Transfer Shared Credits"}
              </button>
            </div>
          </form>

          {/* Group Credit Ledger Table */}
          <div className="metric-card space-y-3">
            <div className="text-sm font-semibold text-gray-900">
              Group Credit Pool &amp; Member Website Ledger
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Kind</th>
                    <th>Scope</th>
                    <th>Reason</th>
                    <th className="text-right">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.billing.ledger.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs text-gray-500">
                        {new Date(row.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            row.amount >= 0
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {row.kind}
                        </span>
                      </td>
                      <td className="text-xs text-gray-600">
                        {row.websiteName ? `Website: ${row.websiteName}` : `Group: ${data.group.name}`}
                      </td>
                      <td className="text-xs text-gray-700">{row.reason ?? "—"}</td>
                      <td
                        className={`text-right font-mono text-xs font-semibold ${
                          row.amount >= 0 ? "text-emerald-700" : "text-gray-900"
                        }`}
                      >
                        {row.amount >= 0 ? `+${row.amount.toLocaleString()}` : row.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {data.billing.ledger.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-gray-400">
                        No credit ledger entries recorded for this group yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
