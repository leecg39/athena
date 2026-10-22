"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import {
  createPillarAction,
  updatePillarAction,
  deletePillarAction,
  createFactAction,
  updateFactAction,
  reviewFactAction,
  deleteFactAction,
  extractFactsAction,
  upsertInternalLinkAction,
  deleteInternalLinkAction,
  syncInternalLinksAction,
} from "@/app/(app)/knowledge-base/actions";

const idle: ActionState = { ok: false };

export interface SerializedPillar {
  id: string;
  name: string;
  document: string | null;
  confirmedCount: number;
  pendingCount: number;
}

export interface SerializedFact {
  id: string;
  pillarId: string;
  pillarName: string;
  claim: string;
  sourceUrl: string | null;
  status: "pending_review" | "confirmed" | "rejected";
  confidence: number;
}

export interface SerializedInternalLink {
  id: string;
  url: string;
  title: string;
  keywords: { keyword: string; position: number }[];
  factCount: number;
  citationCount: number;
}

export function KbWorkspace(props: {
  websiteDomain: string;
  pillars: SerializedPillar[];
  facts: SerializedFact[];
  internalLinks: SerializedInternalLink[];
  counts: {
    pillars: number;
    confirmed: number;
    pendingReview: number;
    rejected: number;
    internalLinks: number;
  };
  initialTab?: "pillars" | "review" | "links";
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<"pillars" | "review" | "links">(props.initialTab ?? "pillars");
  const [selectedPillarId, setSelectedPillarId] = useState<string | "all">("all");
  const [editingPillarId, setEditingPillarId] = useState<string | null>(null);
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkKeywords, setLinkKeywords] = useState("");
  const [lastKey, setLastKey] = useState<string>("extract");

  const [createPillarState, createPillarAct, createPillarPending] = useActionState(createPillarAction, idle);
  const [updatePillarState, updatePillarAct, updatePillarPending] = useActionState(updatePillarAction, idle);
  const [deletePillarState, deletePillarAct, deletePillarPending] = useActionState(deletePillarAction, idle);
  const [createFactState, createFactAct, createFactPending] = useActionState(createFactAction, idle);
  const [updateFactState, updateFactAct, updateFactPending] = useActionState(updateFactAction, idle);
  const [reviewFactState, reviewFactAct, reviewFactPending] = useActionState(reviewFactAction, idle);
  const [deleteFactState, deleteFactAct, deleteFactPending] = useActionState(deleteFactAction, idle);
  const [extractState, extractAct, extractPending] = useActionState(extractFactsAction, idle);
  const [upsertLinkState, upsertLinkAct, upsertLinkPending] = useActionState(upsertInternalLinkAction, idle);
  const [deleteLinkState, deleteLinkAct, deleteLinkPending] = useActionState(deleteInternalLinkAction, idle);
  const [syncLinkState, syncLinkAct, syncLinkPending] = useActionState(syncInternalLinksAction, idle);

  const stateMap: Record<string, ActionState> = {
    createPillar: createPillarState,
    updatePillar: updatePillarState,
    deletePillar: deletePillarState,
    createFact: createFactState,
    updateFact: updateFactState,
    reviewFact: reviewFactState,
    deleteFact: deleteFactState,
    extract: extractState,
    upsertLink: upsertLinkState,
    deleteLink: deleteLinkState,
    syncLink: syncLinkState,
  };
  const states = [
    stateMap[lastKey] ?? idle,
    ...Object.entries(stateMap)
      .filter(([k]) => k !== lastKey)
      .map(([, v]) => v),
  ];
  const errorMsg = states.find((s) => s.error)?.error;
  const infoMsg = states.find((s) => s.message)?.message;

  const confirmedFacts = props.facts.filter(
    (f) => f.status === "confirmed" && (selectedPillarId === "all" || f.pillarId === selectedPillarId),
  );
  const pendingFacts = props.facts.filter((f) => f.status === "pending_review");

  return (
    <div>
      {/* Navigation tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6">
        <div className="flex gap-1" role="tablist" aria-label="Knowledge Base sections">
          {(
            [
              ["pillars", `Pillars & Facts (${props.counts.confirmed})`],
              ["review", `Review pending claims (${props.counts.pendingReview})`],
              ["links", `Internal link pages (${props.counts.internalLinks})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`border-b-2 px-3 py-2.5 text-sm transition ${
                tab === id ? "border-brand-600 font-medium text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 py-2">
          <Link href="/oracle" className="btn-secondary !px-3 !py-1.5 text-xs">
            Open Oracle scanner →
          </Link>
          {props.canWrite ? (
            <form action={extractAct} onSubmit={() => setLastKey("extract")}>
              <button type="submit" disabled={extractPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                {extractPending ? "Extracting…" : "Extract facts from AI answers"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="space-y-6 p-6">
        {errorMsg ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {errorMsg}
          </div>
        ) : null}
        {!errorMsg && infoMsg ? (
          <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {infoMsg}
          </div>
        ) : null}

        {tab === "pillars" ? (
          <div className="space-y-6">
            {/* Create Pillar form */}
            {props.canWrite ? (
              <form action={createPillarAct} onSubmit={() => setLastKey("createPillar")} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Create Knowledge Pillar</div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <input
                    name="name"
                    required
                    placeholder="Pillar name (e.g. Pricing & Plans)"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  <input
                    name="document"
                    placeholder="Reference summary or markdown notes (optional)"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-2"
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="submit" disabled={createPillarPending} className="btn-primary !px-3 !py-1.5 text-xs">
                    {createPillarPending ? "Creating…" : "+ Add pillar"}
                  </button>
                </div>
              </form>
            ) : null}

            {/* Pillar cards */}
            <div className="grid gap-3 md:grid-cols-3">
              {props.pillars.map((p) => {
                const isSelected = selectedPillarId === p.id;
                const isEditing = editingPillarId === p.id;
                return (
                  <div
                    key={p.id}
                    data-testid="kb-pillar-card"
                    className={`metric-card transition ${isSelected ? "border-brand-600 ring-2 ring-brand-100" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => setSelectedPillarId(isSelected ? "all" : p.id)}
                          className="text-left text-sm font-semibold text-gray-900 hover:text-brand-600"
                        >
                          {p.name}
                        </button>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                          <span>{p.confirmedCount} verified facts</span>
                          {p.pendingCount > 0 ? (
                            <span className="badge bg-amber-50 text-amber-700">{p.pendingCount} pending</span>
                          ) : null}
                        </div>
                      </div>
                      {props.canWrite ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setEditingPillarId(isEditing ? null : p.id)}
                            className="text-brand-600 hover:underline"
                          >
                            {isEditing ? "Close" : "Edit"}
                          </button>
                          <form action={deletePillarAct} onSubmit={() => setLastKey("deletePillar")}>
                            <input type="hidden" name="pillarId" value={p.id} />
                            <button type="submit" disabled={deletePillarPending} className="text-red-500 hover:underline">
                              Delete
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>

                    {p.document && !isEditing ? (
                      <p className="mt-2 line-clamp-2 text-xs text-gray-500">{p.document}</p>
                    ) : null}

                    {isEditing && props.canWrite ? (
                      <form
                        action={updatePillarAct}
                        onSubmit={() => {
                          setLastKey("updatePillar");
                          setEditingPillarId(null);
                        }}
                        className="mt-3 space-y-2 border-t border-gray-100 pt-3"
                      >
                        <input type="hidden" name="pillarId" value={p.id} />
                        <input
                          name="name"
                          defaultValue={p.name}
                          required
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs"
                        />
                        <textarea
                          name="document"
                          defaultValue={p.document ?? ""}
                          rows={3}
                          placeholder="Pillar reference document (markdown)"
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs"
                        />
                        <button type="submit" disabled={updatePillarPending} className="btn-primary !px-2.5 !py-1 text-xs">
                          Save pillar
                        </button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Add Brand Fact form */}
            {props.canWrite && props.pillars.length > 0 ? (
              <form action={createFactAct} onSubmit={() => setLastKey("createFact")} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Add Brand Fact</div>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <select
                    name="pillarId"
                    defaultValue={selectedPillarId !== "all" ? selectedPillarId : props.pillars[0]?.id}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    {props.pillars.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    name="claim"
                    required
                    placeholder="Verified brand claim (e.g. Canvasly Pro starts at $29/mo)"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-2"
                  />
                  <input
                    name="sourceUrl"
                    placeholder={`https://${props.websiteDomain}/pricing (optional)`}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <select name="status" defaultValue="confirmed" className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700">
                    <option value="confirmed">Status: Verified (Confirmed)</option>
                    <option value="pending_review">Status: Send to Approval Queue</option>
                  </select>
                  <button type="submit" disabled={createFactPending} className="btn-primary !px-3 !py-1.5 text-xs">
                    {createFactPending ? "Adding…" : "+ Add brand fact"}
                  </button>
                </div>
              </form>
            ) : null}

            {/* Verified Facts list */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Verified Brand Facts ({confirmedFacts.length})</h3>
                  {selectedPillarId !== "all" ? (
                    <button
                      type="button"
                      onClick={() => setSelectedPillarId("all")}
                      className="badge bg-brand-50 text-brand-600 hover:bg-brand-100"
                    >
                      Showing selected pillar · Show all
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {confirmedFacts.map((f) => {
                  const isEditing = editingFactId === f.id;
                  return (
                    <div key={f.id} data-testid="kb-fact-row" className="p-4">
                      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="badge bg-brand-50 text-brand-700">{f.pillarName}</span>
                            <span className="text-sm font-medium text-gray-900">{f.claim}</span>
                          </div>
                          {f.sourceUrl ? (
                            <div className="text-xs text-gray-400">
                              Source:{" "}
                              <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                                {f.sourceUrl}
                              </a>
                            </div>
                          ) : null}
                        </div>

                        {props.canWrite ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingFactId(isEditing ? null : f.id)}
                              className="btn-secondary !px-2.5 !py-1 text-xs"
                            >
                              {isEditing ? "Cancel" : "Edit"}
                            </button>
                            <form action={deleteFactAct} onSubmit={() => setLastKey("deleteFact")}>
                              <input type="hidden" name="factId" value={f.id} />
                              <button type="submit" disabled={deleteFactPending} className="btn-secondary !px-2.5 !py-1 text-xs text-red-600">
                                Delete
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </div>

                      {isEditing && props.canWrite ? (
                        <form
                          action={updateFactAct}
                          onSubmit={() => {
                            setLastKey("updateFact");
                            setEditingFactId(null);
                          }}
                          className="mt-3 grid gap-2 border-t border-gray-100 pt-3 md:grid-cols-4"
                        >
                          <input type="hidden" name="factId" value={f.id} />
                          <select
                            name="pillarId"
                            defaultValue={f.pillarId}
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
                              defaultValue={f.sourceUrl ?? ""}
                              placeholder="Source URL"
                              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs"
                            />
                            <button type="submit" disabled={updateFactPending} className="btn-primary !px-3 !py-1.5 text-xs">
                              Save
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  );
                })}

                {confirmedFacts.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">
                    No verified facts in this view yet. Add a fact above or approve claims from the review queue.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "review" ? (
          <div className="space-y-3">
            {pendingFacts.map((c) => (
              <div
                key={c.id}
                data-testid="kb-pending-claim"
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <form action={reviewFactAct} onSubmit={() => setLastKey("reviewFact")} className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                  <input type="hidden" name="factId" value={c.id} />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-amber-50 text-amber-700">{c.pillarName}</span>
                      <span className="text-xs text-gray-400">
                        confidence {(c.confidence * 100).toFixed(0)}% — extracted from AI answers, awaiting verification
                      </span>
                    </div>
                    <input
                      name="claim"
                      defaultValue={c.claim}
                      readOnly={!props.canWrite}
                      className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800"
                    />
                  </div>
                  {props.canWrite ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="submit"
                        name="decision"
                        value="confirmed"
                        disabled={reviewFactPending}
                        className="btn-primary !px-3 !py-1.5 text-xs"
                      >
                        Approve
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="rejected"
                        disabled={reviewFactPending}
                        className="btn-secondary !px-3 !py-1.5 text-xs"
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </form>
              </div>
            ))}

            {pendingFacts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
                All pending claims have been reviewed. Click “Extract facts from AI answers” to scan for new candidate facts.
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "links" ? (
          <div className="space-y-6">
            {props.canWrite ? (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Add or Update Internal Link Page
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Canonical URLs on <span className="font-medium text-gray-700">{props.websiteDomain}</span> and anchor keywords used when grounding AI content drafts.
                    </p>
                  </div>
                  <form action={syncLinkAct} onSubmit={() => setLastKey("syncLink")}>
                    <button type="submit" disabled={syncLinkPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                      {syncLinkPending ? "Syncing…" : "Sync from AI citations"}
                    </button>
                  </form>
                </div>

                <form
                  action={upsertLinkAct}
                  onSubmit={() => {
                    setLastKey("upsertLink");
                    setLinkUrl("");
                    setLinkTitle("");
                    setLinkKeywords("");
                  }}
                  className="mt-3 grid gap-3 md:grid-cols-4"
                >
                  <input
                    name="url"
                    required
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder={`https://${props.websiteDomain}/pricing`}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  <input
                    name="title"
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder="Page title (e.g. Canvasly Pricing & Plans)"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  <input
                    name="keywords"
                    value={linkKeywords}
                    onChange={(e) => setLinkKeywords(e.target.value)}
                    placeholder="Anchor keywords (comma-separated)"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  <button type="submit" disabled={upsertLinkPending} className="btn-primary !px-3 !py-2 text-xs">
                    {upsertLinkPending ? "Saving…" : "Save internal link"}
                  </button>
                </form>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50/70 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-4 py-3">Internal Page</th>
                    <th className="px-4 py-3">Anchor Keywords</th>
                    <th className="px-4 py-3">Linked Facts</th>
                    <th className="px-4 py-3">AI Citations</th>
                    {props.canWrite ? <th className="px-4 py-3 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {props.internalLinks.map((l) => (
                    <tr key={l.id} data-testid="kb-internal-link-row">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{l.title}</div>
                        <a href={l.url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">
                          {l.url}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {l.keywords.map((k) => (
                            <span key={k.keyword} className="badge bg-gray-100 text-gray-600">
                              {k.keyword}
                            </span>
                          ))}
                          {l.keywords.length === 0 ? <span className="text-xs text-gray-400">—</span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{l.factCount}</td>
                      <td className="px-4 py-3 text-gray-700">{l.citationCount}</td>
                      {props.canWrite ? (
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setLinkUrl(l.url);
                                setLinkTitle(l.title);
                                setLinkKeywords(l.keywords.map((k) => k.keyword).join(", "));
                              }}
                              className="text-xs font-medium text-brand-600 hover:underline"
                            >
                              Edit
                            </button>
                            <form action={deleteLinkAct} onSubmit={() => setLastKey("deleteLink")}>
                              <input type="hidden" name="linkId" value={l.id} />
                              <button type="submit" disabled={deleteLinkPending} className="text-xs font-medium text-red-600 hover:underline">
                                Delete
                              </button>
                            </form>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {props.internalLinks.length === 0 ? (
                    <tr>
                      <td colSpan={props.canWrite ? 5 : 4} className="px-4 py-8 text-center text-sm text-gray-400">
                        No internal link pages yet. Add a canonical brand URL above or click “Sync from AI citations”.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
