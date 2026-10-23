"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { CatalogProductItem } from "@athena/core/content";
import type { ActionState } from "@/lib/action-state";
import {
  syncShopifyCatalogAction,
  generateCatalogDraftAction,
  saveCatalogDraftAction,
  applyCatalogOptimizationAction,
} from "@/app/(app)/content/catalog-optimization/actions";

const idle: ActionState = { ok: false };

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-gray-100">
        <div
          className={`h-1.5 rounded-full ${value < 55 ? "bg-orange-400" : value < 85 ? "bg-blue-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600">{value}</span>
    </div>
  );
}

export function CatalogOptimizationView(props: {
  products: CatalogProductItem[];
  shopifyConnected: boolean;
  storeDomain: string;
  canWrite: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(props.products[0]?.id ?? null);
  const [lastAction, setLastAction] = useState<"sync" | "draft" | "save" | "apply">("sync");

  const [syncState, syncAct, syncPending] = useActionState(syncShopifyCatalogAction, idle);
  const [draftState, draftAct, draftPending] = useActionState(generateCatalogDraftAction, idle);
  const [saveState, saveAct, savePending] = useActionState(saveCatalogDraftAction, idle);
  const [applyState, applyAct, applyPending] = useActionState(applyCatalogOptimizationAction, idle);

  const byLast: Record<typeof lastAction, ActionState[]> = {
    sync: [syncState, draftState, saveState, applyState],
    draft: [draftState, saveState, applyState, syncState],
    save: [saveState, draftState, applyState, syncState],
    apply: [applyState, saveState, draftState, syncState],
  };
  const ordered = byLast[lastAction];
  const errorMsg = ordered.find((s) => s.error)?.error;
  const infoMsg = ordered.find((s) => s.message)?.message;

  const selectedProduct = props.products.find((p) => p.id === selectedId) ?? props.products[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/content" className="btn-secondary !px-3 !py-1.5 text-xs">
            ← Back to Content Hub
          </Link>
          <span
            className={`badge ${props.shopifyConnected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
          >
            {props.shopifyConnected ? `Shopify Connected (${props.storeDomain})` : "Shopify not connected"}
          </span>
        </div>

        {props.canWrite ? (
          <form action={syncAct} onSubmit={() => setLastAction("sync")} className="flex items-center gap-2">
            <button
              type="submit"
              data-testid="catalog-sync-btn"
              disabled={syncPending}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {syncPending ? "Syncing…" : "Sync Shopify catalog"}
            </button>
          </form>
        ) : null}
      </div>

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      ) : null}
      {!errorMsg && infoMsg ? (
        <div
          role="status"
          data-testid="catalog-status-banner"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
        >
          {infoMsg}
        </div>
      ) : null}

      {props.products.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <div className="text-sm font-medium text-gray-900">No Shopify products synced yet</div>
          <p className="mt-1 text-xs text-gray-500">
            {props.shopifyConnected
              ? 'Click "Sync Shopify catalog" above to pull products from your Shopify store.'
              : "Connect your Shopify store (store domain and Admin API token) in Content Hub → CMS connections, then sync your catalog."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price</th>
                <th>AI Shopping Appearances</th>
                <th>Title score</th>
                <th>Description score</th>
                <th>FAQ</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {props.products.map((p) => {
                const isSelected = selectedProduct?.id === p.id;
                return (
                  <tr
                    key={p.id}
                    data-testid="catalog-product-row"
                    data-status={p.optimizationStatus}
                    className={isSelected ? "bg-brand-50/30" : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="text-left font-medium text-brand-600 hover:underline"
                      >
                        {p.title}
                      </button>
                    </td>
                    <td className="text-gray-600">{p.price}</td>
                    <td className="text-gray-600">
                      {p.appearances} ({p.avgPosition > 0 ? `avg #${p.avgPosition.toFixed(1)}` : "—"})
                    </td>
                    <td>
                      <ScoreBar value={p.titleScore} />
                    </td>
                    <td>
                      <ScoreBar value={p.descScore} />
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          p.faqStatus === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-600"
                        }`}
                      >
                        {p.faqStatus}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          p.optimizationStatus === "published"
                            ? "bg-emerald-50 text-emerald-700"
                            : p.optimizationStatus === "draft_ready"
                              ? "bg-purple-50 text-purple-700"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {p.optimizationStatus === "published"
                          ? "Published to Shopify"
                          : p.optimizationStatus === "draft_ready"
                            ? `Draft v${p.version} ready`
                            : "Needs optimization"}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {props.canWrite ? (
                          <form
                            action={draftAct}
                            onSubmit={() => {
                              setLastAction("draft");
                              setSelectedId(p.id);
                            }}
                          >
                            <input type="hidden" name="productId" value={p.id} />
                            <button
                              type="submit"
                              data-testid="catalog-generate-btn"
                              disabled={draftPending}
                              className="btn-secondary !px-3 !py-1 text-xs"
                            >
                              {p.version > 0 ? "Regenerate with AI" : "Draft with AI"}
                            </button>
                          </form>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setSelectedId(p.id)}
                          className="btn-secondary !px-2.5 !py-1 text-xs"
                        >
                          Inspect
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected Product Optimization Editor */}
      {selectedProduct ? (
        <div data-testid="catalog-editor" className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                Shopify Product Editor
              </div>
              <h3 className="mt-0.5 text-base font-semibold text-gray-900">{selectedProduct.title}</h3>
            </div>
            {props.canWrite ? (
              <form action={draftAct} onSubmit={() => setLastAction("draft")}>
                <input type="hidden" name="productId" value={selectedProduct.id} />
                <button type="submit" disabled={draftPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                  {draftPending ? "Drafting…" : "Draft with AI"}
                </button>
              </form>
            ) : null}
          </div>

          <form
            key={`${selectedProduct.id}-v${selectedProduct.version}`}
            action={applyAct}
            onSubmit={() => setLastAction("apply")}
            className="space-y-3"
          >
            <input type="hidden" name="productId" value={selectedProduct.id} />
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Product Title (Title Score: {selectedProduct.titleScore}/100)
              </label>
              <input
                name="title"
                defaultValue={selectedProduct.recommendedTitle ?? selectedProduct.title}
                readOnly={!props.canWrite}
                required
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Product Description (Description Score: {selectedProduct.descScore}/100)
                </label>
                <textarea
                  name="description"
                  defaultValue={selectedProduct.recommendedDescription ?? selectedProduct.currentDescription}
                  placeholder="Write a product description with bullet points, specifications and use cases…"
                  rows={8}
                  readOnly={!props.canWrite}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-200 p-3 font-mono text-xs text-gray-800"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">
                  Product FAQ ({selectedProduct.faqStatus === "ok" ? "2+ questions" : "Add 2+ Q:/A: pairs"})
                </label>
                <textarea
                  name="faq"
                  defaultValue={selectedProduct.recommendedFaq ?? ""}
                  placeholder={"Q: What is included?\nA: ...\nQ: Who is it for?\nA: ..."}
                  rows={8}
                  readOnly={!props.canWrite}
                  className="mt-1 w-full rounded-lg border border-gray-200 p-3 font-mono text-xs text-gray-800"
                />
              </div>
            </div>

            {props.canWrite ? (
              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  formAction={saveAct}
                  onClick={() => setLastAction("save")}
                  disabled={savePending || applyPending}
                  className="btn-secondary !px-4 !py-2 text-xs"
                >
                  {savePending ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="submit"
                  data-testid="catalog-publish-btn"
                  disabled={applyPending || savePending}
                  className="btn-primary !px-4 !py-2 text-xs"
                >
                  {applyPending ? "Publishing to Shopify…" : "Publish to Shopify →"}
                </button>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
