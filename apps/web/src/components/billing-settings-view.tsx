"use client";
import { useTranslations } from "@/components/locale-provider";


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

/** Mirrors CREDIT_PACK_CATALOG / BILLING_ADDON_CATALOG in @athena/core/billing (kept here for the client bundle). */
const CREDIT_PACKS = [
  { id: "pack_1k", label: "+1,000 credits", credits: 1000, priceUsd: 79, description: "1,000 AI answer credits" },
  { id: "pack_5k", label: "+5,000 credits", credits: 5000, priceUsd: 345, description: "5,000 AI answer credits ($0.069/credit)" },
  { id: "pack_15k", label: "+15,000 credits", credits: 15000, priceUsd: 895, description: "15,000 AI answer credits ($0.060/credit)" },
] as const;

const BILLING_ADDONS = [
  { id: "api_mcp_addon", label: "REST API, MCP server and BI connectors", priceMonthlyUsd: 99, bonusCredits: 500, description: "/api/v1, the MCP server and Looker Studio / Power BI feeds, plus 500 credits with each paid month." },
  { id: "pitch_pro_addon", label: "Pitch Pro", priceMonthlyUsd: 75, bonusCredits: 500, description: "Extra pitch capacity for agencies, plus 500 credits with each paid month." },
] as const;

const MODE_NOTE: Record<"stripe" | "test" | "off", { cls: string; text: string }> = {
  stripe: { cls: "border-gray-200 bg-white text-gray-600", text: "Payments go through Stripe Checkout. Plans, packs and add-ons change only after Stripe confirms the payment." },
  test: { cls: "border-amber-200 bg-amber-50 text-amber-800", text: "Billing test mode: changes are applied without payment and recorded as not charged. Never enable this in production." },
  off: { cls: "border-gray-200 bg-gray-50 text-gray-600", text: "Billing isn't configured on this server, so plans and credit packs can't be purchased yet." },
};

export function BillingSettingsView({
  overview,
  plans,
  canWriteBilling,
  mode,
}: {
  overview: BillingOverview;
  plans: BillingPlanCatalogItem[];
  canWriteBilling: boolean;
  mode: "stripe" | "test" | "off";
}) {
  const tt = useTranslations();
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">(
    overview.subscription.billingInterval,
  );

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

      <div className={`rounded-xl border px-4 py-3 text-xs ${MODE_NOTE[mode].cls}`}>{tt(MODE_NOTE[mode].text)}</div>

      {/* Top Executive KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="metric-card">
          <div className="text-xs text-gray-500">{tt("Current Subscription Plan")}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">{tt(currentPlan.label)}</span>
            <span className="badge bg-brand-50 text-[11px] font-semibold uppercase text-brand-700">
              {overview.subscription.billingInterval}
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {tt(currentPlan.priceMonthlyUsd > 0 ? `$${currentPlan.priceMonthlyUsd}/mo` : "Free tier")} ·{tt(" ")}
            {currentPlan.modelsCount} {tt(" AI models · ")}{currentPlan.pitchLimit} {tt(" pitches/mo")}</div>
        </div>

        <div className="metric-card border-brand-200 bg-brand-50/30">
          <div className="text-xs font-medium text-brand-700">{tt("Total Org-Wide Credits")}</div>
          <div className="mt-1 text-xl font-bold text-brand-900">
            {overview.balances.totalOrgWideCredits.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-brand-700">
            {tt("Org: ")}{overview.balances.orgUnallocatedBalance.toLocaleString()} {tt(" · Sites:")}{tt(" ")}
            {overview.balances.totalWebsiteCredits.toLocaleString()} {tt(" · Groups:")}{tt(" ")}
            {overview.balances.totalGroupCredits.toLocaleString()}
          </div>
        </div>

        <div className="metric-card">
          <div className="text-xs text-gray-500">{tt("Monthly Credit Allowance")}</div>
          <div className="mt-1 text-xl font-bold text-gray-900">
            {overview.subscription.monthlyCredits.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {tt("Status: ")}<span className="font-medium text-emerald-700">{tt(overview.subscription.status)}</span> {tt(" · Renews ")}{overview.subscription.currentPeriodEnd ? new Date(overview.subscription.currentPeriodEnd).toISOString().slice(0, 10) : "—"}
          </div>
        </div>

        <div className="metric-card">
          <div className="text-xs text-gray-500">{tt("Active Billing Add-ons")}</div>
          <div className="mt-1 text-xl font-bold text-gray-900">
            {overview.subscription.addons.length} {tt(" active")}</div>
          <div className="mt-1 text-xs text-gray-400">
            {tt(overview.subscription.addons.length > 0
              ? overview.subscription.addons.join(", ")
              : "No recurring add-ons enabled")}
          </div>
        </div>
      </div>

      {/* Section 1: Subscription Plans (Free / Starter $295 / Enterprise) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {tt("Subscription Plans — Free, Starter ($295/mo) & Enterprise")}</h2>
            <p className="text-xs text-gray-500">
              {tt("Higher plans add AI models, monthly credits and pitch capacity.")}</p>
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
              {tt("Monthly Billing")}</button>
            <button
              type="button"
              onClick={() => setBillingInterval("annual")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                billingInterval === "annual"
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {tt("Annual Billing (Save 20%)")}</button>
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
                    <span className="text-base font-bold text-gray-900">{tt(p.label)}</span>
                    {isCurrent ? (
                      <span className="badge bg-brand-600 text-xs text-white">{tt("Current Plan")}</span>
                    ) : p.tier === "starter" ? (
                      <span className="badge bg-emerald-50 text-xs text-emerald-700">
                        {tt("Most Popular")}</span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold text-gray-900">
                      ${displayPrice.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-500">{tt("/ month")}</span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-brand-700">
                    {p.monthlyCredits.toLocaleString()} {tt(" monthly AI response credits")}</div>

                  <ul className="mt-4 space-y-2 text-xs text-gray-600">
                    {p.features.map((f, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-600">✓</span>
                        <span>{tt(f)}</span>
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
                      disabled={planPending || mode === "off" || (isCurrent && overview.subscription.billingInterval === billingInterval)}
                      className={`w-full rounded-lg px-4 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                        p.tier === "starter"
                          ? "bg-brand-600 text-white hover:bg-brand-700"
                          : "border border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100"
                      }`}
                    >
                      {tt(isCurrent && overview.subscription.billingInterval === billingInterval
                        ? tt("Active ({0})", { 0: tt(p.label) })
                        : p.tier === "free"
                          ? "Downgrade to Free"
                          : tt("Upgrade to {0} (${1}/mo)", { 0: tt(p.label), 1: displayPrice }))}
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
              {tt("Multi-Scope Credit System — Organization, Website & Group Balances")}</h2>
            <p className="text-xs text-gray-500">
              {tt("Allocate credits from your Organization Unallocated Pool to dedicated Website workspaces or Agency Portfolio Groups.")}</p>
          </div>
          <span className="badge bg-brand-50 font-mono text-xs text-brand-700">
            {tt("Org Unallocated Pool: ")}{overview.balances.orgUnallocatedBalance.toLocaleString()} {tt(" credits")}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Website Credit Pools */}
          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                {tt("Website Dedicated Credit Pools (")}{overview.balances.websitePools.length})
              </h3>
              <span className="font-mono text-xs font-semibold text-gray-900">
                {overview.balances.totalWebsiteCredits.toLocaleString()} {tt(" credits")}</span>
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
                    {w.balance.toLocaleString()} {tt(" credits")}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Group Shared Credit Pools */}
          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                {tt("Group Shared Credit Pools (")}{overview.balances.groupPools.length})
              </h3>
              <span className="font-mono text-xs font-semibold text-gray-900">
                {overview.balances.totalGroupCredits.toLocaleString()} {tt(" credits")}</span>
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
                      {tt("Manage in Group Billing →")}</Link>
                  </div>
                  <span className="badge bg-emerald-50 font-mono text-xs font-semibold text-emerald-700">
                    {g.balance.toLocaleString()} {tt(" credits")}</span>
                </div>
              ))}
              {overview.balances.groupPools.length === 0 ? (
                <div className="py-4 text-center text-xs text-gray-400">
                  {tt("No portfolio groups created yet.")}{tt(" ")}
                  <Link href="/group" className="text-brand-600 underline">
                    {tt("Open Group Dashboard")}</Link>
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
                {tt("Target Website Pool")}</label>
              <select name="websiteId" className="input-base w-full text-xs">
                {overview.balances.websitePools.map((w) => (
                  <option key={w.websiteId} value={w.websiteId}>
                    {w.websiteName} ({w.domain}) — {w.balance} {tt(" credits")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {tt("Transfer Direction")}</label>
              <select name="direction" className="input-base w-full text-xs">
                <option value="to_website">{tt("Org Unallocated Pool → Website Pool")}</option>
                <option value="to_org">{tt("Website Pool → Org Unallocated Pool")}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {tt("Credits Amount *")}</label>
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
                {tt(webAllocPending ? "Transferring..." : "Transfer Website Credits")}
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
              {tt("Additional Credit Top-Up Packs")}</h2>
            <p className="text-xs text-gray-500">
              {tt("Purchased credits go to the organization pool; allocate them to websites or groups afterwards.")}</p>
          </div>

          <div className="space-y-2.5">
            {CREDIT_PACKS.map((pack) => (
              <form
                key={pack.id}
                action={packFormAction}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/50 p-3.5"
              >
                <input type="hidden" name="packId" value={pack.id} />
                <div>
                  <div className="text-xs font-semibold text-gray-900">{tt(pack.label)}</div>
                  <div className="text-[11px] text-gray-500">{tt(pack.description)}</div>
                </div>
                <button
                  type="submit"
                  disabled={!canWriteBilling || packPending || mode === "off"}
                  className="btn-primary shrink-0 !px-3.5 !py-1.5 text-xs font-semibold"
                >
                  {tt("Buy $")}{pack.priceUsd}
                </button>
              </form>
            ))}
          </div>
        </section>

        {/* API & Agency Add-ons */}
        <section className="metric-card space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {tt("API, MCP & Agency Add-ons")}</h2>
            <p className="text-xs text-gray-500">
              {tt("Enable Public REST API / MCP Server access or Agency Pitch Deck Pro features.")}</p>
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
                        <span className="text-xs font-semibold text-gray-900">{tt(addon.label)}</span>
                        {isEnabled ? (
                          <span className="badge bg-emerald-50 text-[10px] font-semibold text-emerald-700">
                            {tt("Active")}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">{tt(addon.description)}</div>
                      <div className="mt-2 font-mono text-xs font-semibold text-brand-700">
                        ${addon.priceMonthlyUsd}{tt("/month · +")}{addon.bonusCredits} {tt(" bonus credits")}</div>
                    </div>
                    <button
                      type="submit"
                      disabled={!canWriteBilling || addonPending || mode === "off"}
                      className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                        isEnabled
                          ? "border border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
                          : "bg-brand-600 text-white hover:bg-brand-700"
                      }`}
                    >
                      {tt(isEnabled ? "Disable Add-on" : `Enable ($${addon.priceMonthlyUsd}/mo)`)}
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
            {tt("Organization, Website & Group Credit Ledger")}</h2>
          <span className="text-xs text-gray-400">
            {tt("Showing latest ")}{overview.ledger.length} {tt(" entries")}</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>{tt("Date")}</th>
                <th>{tt("Type")}</th>
                <th>{tt("Pool Scope")}</th>
                <th>{tt("Reason")}</th>
                <th className="text-right">{tt("Credits")}</th>
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
                      {tt(l.kind)}
                    </span>
                  </td>
                  <td className="text-xs font-medium text-gray-700">{l.scopeLabel}</td>
                  <td className="text-xs text-gray-500">{l.reason ?? "—"}</td>
                  <td
                    className={`text-right font-mono text-xs font-semibold ${
                      l.amount < 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {tt(l.amount > 0 ? "+" : "")}
                    {l.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
              {overview.ledger.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-gray-400">
                    {tt("No credit ledger entries yet.")}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 5: Invoices & PDF Receipts */}
      <section className="metric-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">{tt("Invoices & Tax Receipts")}</h2>
          <span className="text-xs text-gray-400">{overview.invoices.length} {tt(" invoice(s)")}</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>{tt("Issue Date")}</th>
                <th>{tt("Invoice ID")}</th>
                <th>{tt("Description")}</th>
                <th>{tt("Status")}</th>
                <th className="text-right">{tt("Amount")}</th>
                <th className="text-right">{tt("PDF")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-xs text-gray-500">
                    {inv.issuedAt ? new Date(inv.issuedAt).toISOString().slice(0, 10) : "—"}
                  </td>
                  <td className="font-mono text-xs text-gray-700">
                    {inv.stripeInvoiceId ?? inv.id.slice(0, 12)}
                  </td>
                  <td className="text-xs font-medium text-gray-900">{tt(inv.description)}</td>
                  <td>
                    <span className={`badge text-xs uppercase ${inv.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {tt(inv.status === "test" ? "test · not charged" : inv.status)}
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
                      {tt("⬇ PDF")}</a>
                  </td>
                </tr>
              ))}
              {overview.invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs text-gray-400">
                    {tt("No invoices yet. They appear when Stripe confirms a payment.")}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
