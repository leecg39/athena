"use client";
import { useTranslations } from "@/components/locale-provider";


import { useActionState, useState } from "react";
import type {
  ShoppingBrandComparison,
  ShoppingProductItem,
  ShoppingRetailerDistribution,
} from "@athena/core/commerce";
import {
  syncShoppingInsightsAction,
  createShoppingProductAction,
  deleteShoppingProductAction,
} from "@/app/(app)/shopping/actions";
import type { ActionState } from "@/lib/action-state";

const idle: ActionState = { ok: false };

interface Props {
  products: ShoppingProductItem[];
  brandComparison: ShoppingBrandComparison[];
  retailerDistribution: ShoppingRetailerDistribution[];
  retailers: string[];
  canWrite: boolean;
}

export function ShoppingInsightsView(props: Props) {
  const tt = useTranslations();
  const [activeTab, setActiveTab] = useState<"leaderboard" | "brands" | "retailers">("leaderboard");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "own" | "competitor">("all");
  const [retailerFilter, setRetailerFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [lastKey, setLastKey] = useState<string>("sync");

  const [syncState, syncAct, syncPending] = useActionState(syncShoppingInsightsAction, idle);
  const [createState, createAct, createPending] = useActionState(createShoppingProductAction, idle);
  const [deleteState, deleteAct, deletePending] = useActionState(deleteShoppingProductAction, idle);

  const stateMap: Record<string, ActionState> = {
    sync: syncState,
    create: createState,
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

  const filteredProducts = props.products.filter((p) => {
    if (ownershipFilter === "own" && !p.isOwn) return false;
    if (ownershipFilter === "competitor" && p.isOwn) return false;
    if (retailerFilter !== "all" && p.retailer !== retailerFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${p.title} ${p.brand} ${p.retailer}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const maxAppearances = Math.max(1, ...filteredProducts.map((p) => p.appearances));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
            <button
              type="button"
              data-testid="shopping-tab-leaderboard"
              onClick={() => setActiveTab("leaderboard")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "leaderboard" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tt("Carousel Leaderboard (")}{props.products.length})
            </button>
            <button
              type="button"
              data-testid="shopping-tab-brands"
              onClick={() => setActiveTab("brands")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "brands" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tt("Brand vs Competitor (")}{props.brandComparison.length})
            </button>
            <button
              type="button"
              data-testid="shopping-tab-retailers"
              onClick={() => setActiveTab("retailers")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "retailers" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {tt("Retailer Distribution (")}{props.retailerDistribution.length})
            </button>
          </div>

          {activeTab === "leaderboard" ? (
            <>
              <select
                value={ownershipFilter}
                onChange={(e) => setOwnershipFilter(e.target.value as "all" | "own" | "competitor")}
                aria-label={tt("Filter by ownership")}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700"
              >
                <option value="all">{tt("All Brands")}</option>
                <option value="own">{tt("Own Products Only")}</option>
                <option value="competitor">{tt("Competitors Only")}</option>
              </select>

              <select
                value={retailerFilter}
                onChange={(e) => setRetailerFilter(e.target.value)}
                aria-label={tt("Filter by retailer")}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700"
              >
                <option value="all">{tt("All Retailers (")}{props.retailers.length})</option>
                {props.retailers.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tt("Search product, brand, or retailer…")}
                className="w-52 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-800"
              />
            </>
          ) : null}
        </div>

        {props.canWrite ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              {tt("+ Track product")}</button>
            <form action={syncAct} onSubmit={() => setLastKey("sync")}>
              <button
                type="submit"
                disabled={syncPending}
                className="btn-primary !px-3 !py-1.5 text-xs"
              >
                {tt(syncPending ? "Syncing…" : "Sync from collected answers")}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {/* Banners */}
      {errorMsg ? (
        <div
          role="alert"
          data-testid="shopping-error-banner"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {tt(errorMsg)}
        </div>
      ) : null}
      {!errorMsg && infoMsg ? (
        <div
          role="status"
          data-testid="shopping-status-banner"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
        >
          {tt(infoMsg)}
        </div>
      ) : null}

      {/* Expandable Add Product Form */}
      {showAddForm && props.canWrite ? (
        <form
          action={createAct}
          onSubmit={() => setLastKey("create")}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {tt("Track Product in AI Shopping Carousel")}</div>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-gray-400">
              {tt("Close")}</button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-6">
            <input
              name="title"
              required
              placeholder={tt("Product title (e.g. Canvasly Design System Kit)")}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs md:col-span-2"
            />
            <input
              name="retailer"
              required
              placeholder={tt("Retailer (e.g. Amazon, G2 Marketplace)")}
              defaultValue="Amazon"
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <input
              name="price"
              type="number"
              step="0.01"
              min="0"
              defaultValue="22.00"
              placeholder={tt("Price ($)")}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <select
              name="isOwn"
              defaultValue="true"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
            >
              <option value="true">{tt("Own Brand Product")}</option>
              <option value="false">{tt("Competitor Product")}</option>
            </select>
            <button type="submit" disabled={createPending} className="btn-primary !px-3 !py-2 text-xs">
              {tt(createPending ? "Adding…" : "Add Product")}
            </button>
          </div>
        </form>
      ) : null}

      {/* TAB 1: Carousel Leaderboard */}
      {activeTab === "leaderboard" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="table-base">
            <thead>
              <tr>
                <th>{tt("Product")}</th>
                <th>{tt("Brand")}</th>
                <th>{tt("Retailer")}</th>
                <th>{tt("Carousel Appearances")}</th>
                <th>{tt("Share")}</th>
                <th>{tt("Avg Position")}</th>
                <th>{tt("Price & Market Tier")}</th>
                {props.canWrite ? <th className="text-right">{tt("Action")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium text-gray-900">{p.title}</div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        p.isOwn ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {tt(p.isOwn ? `★ ${p.brand} (Own)` : p.brand)}
                    </span>
                  </td>
                  <td className="text-xs text-gray-600">{p.retailer}</td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="h-2 w-28 rounded-full bg-gray-100">
                        <div
                          className={`h-2 rounded-full ${p.isOwn ? "bg-brand-600" : "bg-gray-400"}`}
                          style={{ width: `${Math.max(6, (p.appearances / maxAppearances) * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs font-medium text-gray-800">
                        {p.appearances.toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td className="font-mono text-xs font-semibold text-gray-800">{p.sharePct.toFixed(1)}%</td>
                  <td className="font-mono text-xs text-gray-700">#{p.avgPosition.toFixed(1)}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-gray-900">
                        ${p.price.toFixed(2)}
                      </span>
                      <span
                        className={`badge text-[10px] ${
                          p.pricePositioning === "below_market"
                            ? "bg-emerald-50 text-emerald-700"
                            : p.pricePositioning === "above_market"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {tt(p.pricePositioning === "below_market"
                          ? "Below avg"
                          : p.pricePositioning === "above_market"
                            ? "Premium"
                            : "Market avg")}
                      </span>
                    </div>
                  </td>
                  {props.canWrite ? (
                    <td className="text-right">
                      <form action={deleteAct} onSubmit={() => setLastKey("delete")}>
                        <input type="hidden" name="productId" value={p.id} />
                        <button
                          type="submit"
                          disabled={deletePending}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          {tt("Remove")}</button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* TAB 2: Brand vs Competitor Comparison */}
      {activeTab === "brands" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="table-base" data-testid="shopping-brand-comparison-table">
            <thead>
              <tr>
                <th>{tt("Brand")}</th>
                <th>{tt("Role")}</th>
                <th>{tt("Products in Carousel")}</th>
                <th>{tt("Total Appearances")}</th>
                <th>{tt("Share of Carousel")}</th>
                <th>{tt("Weighted Avg Position")}</th>
                <th>{tt("Avg Price Shown")}</th>
                <th>{tt("Primary Retailer")}</th>
              </tr>
            </thead>
            <tbody>
              {props.brandComparison.map((b) => (
                <tr key={`${b.isOwn ? "own" : "comp"}-${b.brand}`}>
                  <td className="font-semibold text-gray-900">{b.brand}</td>
                  <td>
                    <span
                      className={`badge ${
                        b.isOwn ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tt(b.isOwn ? "Own Brand" : "Competitor")}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{b.productCount}</td>
                  <td className="font-mono text-xs font-medium">{b.appearances.toLocaleString()}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-gray-100">
                        <div
                          className={`h-2 rounded-full ${b.isOwn ? "bg-brand-600" : "bg-gray-400"}`}
                          style={{ width: `${Math.min(100, Math.max(6, b.sharePct))}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs font-semibold text-brand-700">
                        {b.sharePct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="font-mono text-xs">#{b.avgPosition.toFixed(2)}</td>
                  <td className="font-mono text-xs">${b.avgPrice.toFixed(2)}</td>
                  <td className="text-xs text-gray-600">{b.topRetailer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* TAB 3: Retailer Distribution */}
      {activeTab === "retailers" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="table-base" data-testid="shopping-retailer-distribution-table">
            <thead>
              <tr>
                <th>{tt("Retailer / Marketplace")}</th>
                <th>{tt("Total Appearances")}</th>
                <th>{tt("Retailer Share")}</th>
                <th>{tt("Own vs Competitor Split")}</th>
                <th>{tt("Own Brand Share in Retailer")}</th>
                <th>{tt("Products Listed")}</th>
                <th>{tt("Avg Price")}</th>
              </tr>
            </thead>
            <tbody>
              {props.retailerDistribution.map((r) => (
                <tr key={r.retailer}>
                  <td className="font-semibold text-gray-900">{r.retailer}</td>
                  <td className="font-mono text-xs font-medium">
                    {r.totalAppearances.toLocaleString()}
                  </td>
                  <td className="font-mono text-xs font-semibold text-gray-800">
                    {r.sharePct.toFixed(1)}%
                  </td>
                  <td>
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="font-medium text-brand-700">
                        {tt("Own: ")}{r.ownAppearances.toLocaleString()}
                      </span>
                      <span>·</span>
                      <span>{tt("Comp: ")}{r.competitorAppearances.toLocaleString()}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-brand-600"
                          style={{ width: `${Math.min(100, r.ownShareWithinRetailerPct)}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs font-semibold text-brand-700">
                        {r.ownShareWithinRetailerPct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="font-mono text-xs">{r.productCount}</td>
                  <td className="font-mono text-xs">${r.avgPrice.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
