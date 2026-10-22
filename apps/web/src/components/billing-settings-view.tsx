"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { BillingOverview, BillingPlanCatalogItem } from "@athena/core/billing";
import type { ActionState } from "@/lib/action-state";
import {
  allocateWebsiteCreditsAction,
  changeSubscriptionPlanAction,
  purchaseCreditPackAction,
  toggleBillingAddonAction,
} from "@/app/(app)/settings/billing/actions";

const idle: ActionState = { ok: false };

const CREDIT_PACKS = [
  {
    id: "pack_1k",
    label: "+1,000 Credits Top-Up Pack",
    credits: 1000,
    priceUsd: 79,
    description: "Instant 1,000 AI response credits (never expire while subscription is active)",
  },
  {
    id: "pack_5k",
    label: "+5,000 Credits Growth Pack",
    credits: 5000,
    priceUsd: 345,
    description: "5,000 AI response credits ($0.069/credit — save 13%)",
  },
  {
    id: "pack_15k",
    label: "+15,000 Credits Scale Pack",
    credits: 15000,
    priceUsd: 895,
    description: "15,000 AI response credits for high-frequency multi-brand tracking (save 24%)",
  },
] as const;

const BILLING_ADDONS = [
  {
    id: "api_mcp_addon",
    label: "Public REST API, MCP Server & BI Connectors Add-on",
    priceMonthlyUsd: 99,
    bonusCredits: 500,
    description:
      "Unlocks high-throughput /api/v1/* endpoints, ChatGPT/Claude MCP Server, and Looker Studio / Power BI feeds (+500 monthly credits).",
  },
  {
    id: "pitch_pro_addon",
    label: "Agency Pitch Deck Pro Add-on",
    priceMonthlyUsd: 75,
    bonusCredits: 500,
    description:
      "Unlocks agency prospect pitch templates, custom PDF export branding, and +500 bonus monthly credits.",
  },
] as const;

export function BillingSettingsView({
  overview,
  plans,
  canWriteBilling,
}: {
  overview: BillingOverview;
  plans: BillingPlanCatalogItem[];
  canWriteBilling: boolean;
}) {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">(
    overview.subscription.billingInterval,
  );
  const [packTargetScope, setPackTargetScope] = useState<string>("organization");

  const [planState, planFormAction, planPending] = useActionState(
    changeSubscriptionPlanAction,
    idle,
  );
  const [packState, packFormAction, packPending] = useActionState(purchaseCreditPackAction, idle);
  const [addonState, addonFormAction, addonPending] = useActionState(
    toggleBillingAddonAction,
    idle,
  );
  const [webAllocState, webAllocFormAction, webAllocPending] = useActionState(
    allocateWebsiteCreditsAction,
    idle,
  );

  const banner = [planState, packState, addonState, webAllocState].find(
    (s) => s.message || s.error,
  );

  const currentPlan =
    plans.find((p) => p.tier === overview.organization.plan) ?? plans[0]!;

  return (
    <div className="space-y-8">
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

      {/* Top Executive KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="metric-card">
          <div className="text-xs text-gray-500">Current Subscription Plan</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">{currentPlan.label}</span>
            <span className="badge bg-brand-50 text-[11px] font-semibold uppercase text-brand-700">
              {overview.subscription.billingInterval}
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {currentPlan.priceMonthlyUsd > 0 ? `$${currentPlan.priceMonthlyUsd}/mo` : "Free tier"} ·{" "}
            {currentPlan.modelsCount} AI models · {currentPlan.pitchLimit} pitches/mo
          </div>
        </div>

        <div className="metric-card border-brand-200 bg-brand-50/30">
          <div className="text-xs font-medium text-brand-700">Total Org-Wide Credits</div>
          <div className="mt-1 text-xl font-bold text-brand-900">
            {overview.balances.totalOrgWideCredits.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-brand-700">
            Org: {overview.balances.orgUnallocatedBalance.toLocaleString()} · Sites:{" "}
            {overview.balances.totalWebsiteCredits.toLocaleString()} · Groups:{" "}
            {overview.balances.totalGroupCredits.toLocaleString()}
          </div>
        </div>

        <div className="metric-card">
          <div className="text-xs text-gray-500">Monthly Credit Allowance</div>
          <div className="mt-1 text-xl font-bold text-gray-900">
            {overview.subscription.monthlyCredits.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            Status: <span className="font-medium text-emerald-700">{overview.subscription.status}</span> ·
            Renews {new Date(overview.subscription.currentPeriodEnd).toISOString().slice(0, 10)}
          </div>
        </div>

        <div className="metric-card">
          <div className="text-xs text-gray-500">Active Billing Add-ons</div>
          <div className="mt-1 text-xl font-bold text-gray-900">
            {overview.subscription.addons.length} active
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {overview.subscription.addons.length > 0
              ? overview.subscription.addons.join(", ")
              : "No recurring add-ons enabled"}
          </div>
        </div>
      </div>

      {/* Section 1: Subscription Plans (Free / Starter $295 / Enterprise) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Subscription Plans — Free, Starter ($295/mo) &amp; Enterprise
            </h2>
            <p className="text-xs text-gray-500">
              Upgrade anytime to unlock all 11 AI search engines, higher monthly credit allowances,
              and agency pitch quotas.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-xs">
            <button
              type="button"
              onClick={() => setBillingInterval("monthly")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                billingInterval === "monthly"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => setBillingInterval("annual")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                billingInterval === "annual"
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              Annual Billing (Save 20%)
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const isCurrent = overview.organization.plan === p.tier;
            const displayPrice =
              billingInterval === "annual" ? p.priceAnnualMonthlyUsd : p.priceMonthlyUsd;

            return (
              <div
                key={p.tier}
                className={`flex flex-col justify-between rounded-xl border p-5 transition ${
                  isCurrent
                    ? "border-brand-500 bg-brand-50/20 ring-1 ring-brand-300"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-gray-900">{p.label}</span>
                    {isCurrent ? (
                      <span className="badge bg-brand-600 text-xs text-white">Current Plan</span>
                    ) : p.tier === "starter" ? (
                      <span className="badge bg-emerald-50 text-xs text-emerald-700">
                        Most Popular
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold text-gray-900">
                      ${displayPrice.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-500">/ month</span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-brand-700">
                    {p.monthlyCredits.toLocaleString()} monthly AI response credits
                  </div>

                  <ul className="mt-4 space-y-2 text-xs text-gray-600">
                    {p.features.map((f, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-600">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {canWriteBilling ? (
                  <form action={planFormAction} className="mt-5">
                    <input type="hidden" name="plan" value={p.tier} />
                    <input type="hidden" name="billingInterval" value={billingInterval} />
                    <button
                      type="submit"
                      disabled={planPending || (isCurrent && overview.subscription.billingInterval === billingInterval)}
                      className={`w-full rounded-lg px-4 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                        p.tier === "starter"
                          ? "bg-brand-600 text-white hover:bg-brand-700"
                          : "border border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100"
                      }`}
                    >
                      {isCurrent && overview.subscription.billingInterval === billingInterval
                        ? `Active (${p.label})`
                        : p.tier === "free"
                          ? "Downgrade to Free"
                          : `Upgrade to ${p.label} ($${displayPrice}/mo)`}
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2: Multi-Scope Credit Balances (Organization / Website / Group Pools) */}
      <section className="metric-card space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Multi-Scope Credit System — Organization, Website &amp; Group Balances
            </h2>
            <p className="text-xs text-gray-500">
              Allocate credits from your Organization Unallocated Pool to dedicated Website
              workspaces or Agency Portfolio Groups.
            </p>
          </div>
          <span className="badge bg-brand-50 font-mono text-xs text-brand-700">
            Org Unallocated Pool: {overview.balances.orgUnallocatedBalance.toLocaleString()} credits
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Website Credit Pools */}
          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                Website Dedicated Credit Pools ({overview.balances.websitePools.length})
              </h3>
              <span className="font-mono text-xs font-semibold text-gray-900">
                {overview.balances.totalWebsiteCredits.toLocaleString()} credits
              </span>
            </div>
            <div className="space-y-2">
              {overview.balances.websitePools.map((w) => (
                <div
                  key={w.websiteId}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-semibold text-gray-900">{w.websiteName}</div>
                    <div className="font-mono text-[11px] text-gray-400">{w.domain}</div>
                  </div>
                  <span className="badge bg-brand-50 font-mono text-xs font-semibold text-brand-700">
                    {w.balance.toLocaleString()} credits
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Group Shared Credit Pools */}
          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                Group Shared Credit Pools ({overview.balances.groupPools.length})
              </h3>
              <span className="font-mono text-xs font-semibold text-gray-900">
                {overview.balances.totalGroupCredits.toLocaleString()} credits
              </span>
            </div>
            <div className="space-y-2">
              {overview.balances.groupPools.map((g) => (
                <div
                  key={g.groupId}
                  className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-semibold text-gray-900">{g.groupName}</div>
                    <Link
                      href={`/group/${g.groupId}?tab=billing`}
                      className="text-[11px] text-brand-600 underline"
                    >
                      Manage in Group Billing →
                    </Link>
                  </div>
                  <span className="badge bg-emerald-50 font-mono text-xs font-semibold text-emerald-700">
                    {g.balance.toLocaleString()} credits
                  </span>
                </div>
              ))}
              {overview.balances.groupPools.length === 0 ? (
                <div className="py-4 text-center text-xs text-gray-400">
                  No portfolio groups created yet.{" "}
                  <Link href="/group" className="text-brand-600 underline">
                    Open Group Dashboard
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Website Credit Allocation Form */}
        {canWriteBilling && overview.balances.websitePools.length > 0 ? (
          <form
            action={webAllocFormAction}
            className="grid gap-3 rounded-xl border border-gray-100 bg-white p-4 md:grid-cols-4"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Target Website Pool
              </label>
              <select name="websiteId" className="input-base w-full text-xs">
                {overview.balances.websitePools.map((w) => (
                  <option key={w.websiteId} value={w.websiteId}>
                    {w.websiteName} ({w.domain}) — {w.balance} credits
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Transfer Direction
              </label>
              <select name="direction" className="input-base w-full text-xs">
                <option value="to_website">Org Unallocated Pool → Website Pool</option>
                <option value="to_org">Website Pool → Org Unallocated Pool</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Credits Amount *
              </label>
              <input
                type="number"
                name="amount"
                min={1}
                max={100000}
                defaultValue={150}
                required
                className="input-base w-full text-xs"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={webAllocPending}
                className="btn-secondary w-full !py-2 text-xs font-semibold"
              >
                {webAllocPending ? "Transferring..." : "Transfer Website Credits"}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {/* Section 3: Additional Credit Top-Up Packs & API / MCP Add-ons */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Additional Credit Packs */}
        <section className="metric-card space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Additional Credit Top-Up Packs
            </h2>
            <p className="text-xs text-gray-500">
              Purchase instant AI response credit packs and deposit them into your Organization,
              Website, or Group pool.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Deposit Purchased Credits Into:
            </label>
            <select
              value={packTargetScope}
              onChange={(e) => setPackTargetScope(e.target.value)}
              className="input-base w-full text-xs"
            >
              <option value="organization">
                Organization Unallocated Pool ({overview.balances.orgUnallocatedBalance.toLocaleString()} credits)
              </option>
              {overview.balances.websitePools.map((w) => (
                <option key={w.websiteId} value={`website:${w.websiteId}`}>
                  Website Pool: {w.websiteName} ({w.balance.toLocaleString()} credits)
                </option>
              ))}
              {overview.balances.groupPools.map((g) => (
                <option key={g.groupId} value={`group:${g.groupId}`}>
                  Group Shared Pool: {g.groupName} ({g.balance.toLocaleString()} credits)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2.5">
            {CREDIT_PACKS.map((pack) => (
              <form
                key={pack.id}
                action={packFormAction}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/50 p-3.5"
              >
                <input type="hidden" name="packId" value={pack.id} />
                <input type="hidden" name="targetScope" value={packTargetScope} />
                <div>
                  <div className="text-xs font-semibold text-gray-900">{pack.label}</div>
                  <div className="text-[11px] text-gray-500">{pack.description}</div>
                </div>
                <button
                  type="submit"
                  disabled={!canWriteBilling || packPending}
                  className="btn-primary shrink-0 !px-3.5 !py-1.5 text-xs font-semibold"
                >
                  Buy ${pack.priceUsd}
                </button>
              </form>
            ))}
          </div>
        </section>

        {/* API & Agency Add-ons */}
        <section className="metric-card space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              API, MCP &amp; Agency Add-ons
            </h2>
            <p className="text-xs text-gray-500">
              Enable Public REST API / MCP Server access or Agency Pitch Deck Pro features.
            </p>
          </div>

          <div className="space-y-3">
            {BILLING_ADDONS.map((addon) => {
              const isEnabled = overview.subscription.addons.includes(addon.id);
              return (
                <form
                  key={addon.id}
                  action={addonFormAction}
                  className={`rounded-xl border p-4 ${
                    isEnabled
                      ? "border-brand-300 bg-brand-50/30"
                      : "border-gray-100 bg-gray-50/50"
                  }`}
                >
                  <input type="hidden" name="addonId" value={addon.id} />
                  <input type="hidden" name="enabled" value={isEnabled ? "false" : "true"} />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-900">{addon.label}</span>
                        {isEnabled ? (
                          <span className="badge bg-emerald-50 text-[10px] font-semibold text-emerald-700">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">{addon.description}</div>
                      <div className="mt-2 font-mono text-xs font-semibold text-brand-700">
                        ${addon.priceMonthlyUsd}/month · +{addon.bonusCredits} bonus credits
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={!canWriteBilling || addonPending}
                      className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                        isEnabled
                          ? "border border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
                          : "bg-brand-600 text-white hover:bg-brand-700"
                      }`}
                    >
                      {isEnabled ? "Disable Add-on" : `Enable ($${addon.priceMonthlyUsd}/mo)`}
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        </section>
      </div>

      {/* Section 4: Credit Ledger */}
      <section className="metric-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Organization, Website &amp; Group Credit Ledger
          </h2>
          <span className="text-xs text-gray-400">
            Showing latest {overview.ledger.length} entries
          </span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Pool Scope</th>
                <th>Reason</th>
                <th className="text-right">Credits</th>
              </tr>
            </thead>
            <tbody>
              {overview.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-xs text-gray-500">
                    {new Date(l.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        l.amount >= 0
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {l.kind}
                    </span>
                  </td>
                  <td className="text-xs font-medium text-gray-700">{l.scopeLabel}</td>
                  <td className="text-xs text-gray-500">{l.reason ?? "—"}</td>
                  <td
                    className={`text-right font-mono text-xs font-semibold ${
                      l.amount < 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {l.amount > 0 ? "+" : ""}
                    {l.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
              {overview.ledger.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-gray-400">
                    No credit ledger entries yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 5: Invoices & PDF Receipts */}
      <section className="metric-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Invoices &amp; Tax Receipts</h2>
          <span className="text-xs text-gray-400">{overview.invoices.length} invoice(s)</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>Issue Date</th>
                <th>Invoice ID</th>
                <th>Description</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Receipt PDF</th>
              </tr>
            </thead>
            <tbody>
              {overview.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-xs text-gray-500">
                    {new Date(inv.issuedAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="font-mono text-xs text-gray-700">
                    {inv.stripeInvoiceId ?? inv.id.slice(0, 12)}
                  </td>
                  <td className="text-xs font-medium text-gray-900">{inv.description}</td>
                  <td>
                    <span className="badge bg-emerald-50 text-xs uppercase text-emerald-700">
                      {inv.status}
                    </span>
                  </td>
                  <td className="text-right font-mono text-xs font-semibold text-gray-900">
                    ${(inv.amountCents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                  </td>
                  <td className="text-right">
                    <a
                      href={inv.pdfUrl}
                      className="btn-secondary !px-2.5 !py-1 text-xs"
                    >
                      ⬇ PDF
                    </a>
                  </td>
                </tr>
              ))}
              {overview.invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs text-gray-400">
                    No invoices issued yet. Upgrade a plan, enable an add-on, or purchase a credit
                    pack to generate an invoice.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
