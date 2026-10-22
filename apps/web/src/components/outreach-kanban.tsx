"use client";

import { useActionState, useState } from "react";
import type { OutreachStatus } from "@athena/core/outreach";
import type { ActionState } from "@/lib/action-state";
import {
  discoverOutreachAction,
  createOutreachOpportunityAction,
  findOutreachAuthorAction,
  generateOutreachDraftAction,
  updateOutreachStatusAction,
  updateOutreachDetailsAction,
  deleteOutreachOpportunityAction,
} from "@/app/(app)/outreach/actions";

const idle: ActionState = { ok: false };

const COLUMNS: { status: OutreachStatus; label: string; hint: string }[] = [
  { status: "new", label: "New Opportunities", hint: "High-citation pages omitting your brand" },
  { status: "todo", label: "Todo (Pitch Ready)", hint: "Author identified & email drafted" },
  { status: "done", label: "Done (Contacted)", hint: "Pitch sent or placement secured" },
];

export interface SerializedOutreachItem {
  id: string;
  url: string;
  domain: string;
  status: OutreachStatus;
  citationPct: number;
  estimatedImpressions: number;
  citations: number;
  authorName: string | null;
  authorEmail: string | null;
  emailDraft: string | null;
  notes: string | null;
}

export function OutreachKanban(props: {
  opportunities: SerializedOutreachItem[];
  counts: { new: number; todo: number; done: number; total: number };
  domains: string[];
  canWrite: boolean;
}) {
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(props.opportunities[0]?.id ?? null);
  const [lastKey, setLastKey] = useState<string>("discover");

  const [discoverState, discoverAct, discoverPending] = useActionState(discoverOutreachAction, idle);
  const [createState, createAct, createPending] = useActionState(createOutreachOpportunityAction, idle);
  const [authorState, authorAct, authorPending] = useActionState(findOutreachAuthorAction, idle);
  const [draftState, draftAct, draftPending] = useActionState(generateOutreachDraftAction, idle);
  const [statusState, statusAct, statusPending] = useActionState(updateOutreachStatusAction, idle);
  const [detailsState, detailsAct, detailsPending] = useActionState(updateOutreachDetailsAction, idle);
  const [deleteState, deleteAct, deletePending] = useActionState(deleteOutreachOpportunityAction, idle);

  const stateMap: Record<string, ActionState> = {
    discover: discoverState,
    create: createState,
    author: authorState,
    draft: draftState,
    status: statusState,
    details: detailsState,
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

  const filtered = props.opportunities.filter((o) => {
    if (domainFilter !== "all" && o.domain !== domainFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${o.url} ${o.domain} ${o.authorName ?? ""} ${o.authorEmail ?? ""} ${o.notes ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const selectedItem = props.opportunities.find((o) => o.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
            <button
              type="button"
              data-testid="outreach-view-kanban"
              onClick={() => setViewMode("kanban")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                viewMode === "kanban" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Kanban Pipeline ({props.counts.total})
            </button>
            <button
              type="button"
              data-testid="outreach-view-table"
              onClick={() => setViewMode("table")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                viewMode === "table" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Opportunity Pages Table
            </button>
          </div>

          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700"
          >
            <option value="all">All domains ({props.domains.length})</option>
            {props.domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search URL, domain, author…"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
          />
        </div>

        {props.canWrite ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="outreach-add-btn"
              onClick={() => setShowAddForm(!showAddForm)}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              + Add opportunity URL
            </button>
            <form action={discoverAct} onSubmit={() => setLastKey("discover")}>
              <button
                type="submit"
                data-testid="outreach-discover-btn"
                disabled={discoverPending}
                className="btn-primary !px-3 !py-1.5 text-xs"
              >
                {discoverPending ? "Scanning citations…" : "Discover citation opportunities"}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {/* Banners */}
      {errorMsg ? (
        <div role="alert" data-testid="outreach-error-banner" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      ) : null}
      {!errorMsg && infoMsg ? (
        <div role="status" data-testid="outreach-status-banner" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {infoMsg}
        </div>
      ) : null}

      {/* Expandable Add Opportunity Form */}
      {showAddForm && props.canWrite ? (
        <form
          action={createAct}
          onSubmit={() => {
            setLastKey("create");
          }}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Add External Citation Opportunity Page
            </div>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-gray-400">
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <input
              name="url"
              required
              placeholder="https://smashingmagazine.com/2026/09/best-design-tools"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-2"
            />
            <input
              name="notes"
              placeholder="Editorial note (e.g. Lists Figma & Canva, omits us)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={createPending} className="btn-primary !px-3 !py-2 text-xs">
              {createPending ? "Adding…" : "Add to Pipeline"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Kanban Pipeline View */}
      {viewMode === "kanban" ? (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const colItems = filtered.filter((i) => i.status === col.status);
            return (
              <div
                key={col.status}
                data-testid={`outreach-column-${col.status}`}
                className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5"
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{col.label}</div>
                    <div className="text-[11px] text-gray-400">{col.hint}</div>
                  </div>
                  <span className="badge bg-white text-gray-600 shadow-2xs">{colItems.length}</span>
                </div>

                <div className="space-y-2.5">
                  {colItems.map((i) => {
                    const isSelected = selectedItem?.id === i.id;
                    return (
                      <div
                        key={i.id}
                        data-testid="outreach-card"
                        data-status={i.status}
                        className={`rounded-xl border bg-white p-3.5 shadow-2xs transition ${
                          isSelected ? "border-brand-600 ring-2 ring-brand-100" : "border-gray-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedId(i.id)}
                            className="truncate text-left text-xs font-semibold text-brand-600 hover:underline"
                          >
                            {i.url.replace(/^https?:\/\//, "")}
                          </button>
                          <span className="badge shrink-0 bg-gray-100 text-gray-600">{i.domain}</span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
                          <span>
                            Citation <strong className="text-gray-800">{i.citationPct.toFixed(1)}%</strong>
                          </span>
                          <span>
                            Est. Impr. <strong className="text-gray-800">{(i.estimatedImpressions / 1000).toFixed(1)}k</strong>
                          </span>
                          <span>
                            Citations <strong className="text-gray-800">{i.citations}</strong>
                          </span>
                        </div>

                        {i.authorName ? (
                          <div className="mt-2 rounded-lg bg-brand-50/60 px-2.5 py-1.5 text-[11px] text-brand-900">
                            <span className="font-medium">{i.authorName}</span>
                            {i.authorEmail ? <span className="ml-1 text-brand-700">&lt;{i.authorEmail}&gt;</span> : null}
                          </div>
                        ) : null}

                        {i.emailDraft ? (
                          <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 font-sans text-[11px] text-gray-600">
                            {i.emailDraft}
                          </pre>
                        ) : null}

                        {props.canWrite ? (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5">
                            <form
                              action={authorAct}
                              onSubmit={() => {
                                setLastKey("author");
                                setSelectedId(i.id);
                              }}
                            >
                              <input type="hidden" name="opportunityId" value={i.id} />
                              <button
                                type="submit"
                                data-testid="outreach-find-author-btn"
                                disabled={authorPending}
                                className="btn-secondary !px-2 !py-0.5 text-[11px]"
                              >
                                🔍 {i.authorName ? "Refresh author" : "Find author"}
                              </button>
                            </form>

                            <form
                              action={draftAct}
                              onSubmit={() => {
                                setLastKey("draft");
                                setSelectedId(i.id);
                              }}
                            >
                              <input type="hidden" name="opportunityId" value={i.id} />
                              <button
                                type="submit"
                                data-testid="outreach-draft-btn"
                                disabled={draftPending}
                                className="btn-secondary !px-2 !py-0.5 text-[11px]"
                              >
                                ✉ {i.emailDraft ? "Regenerate pitch" : "Draft pitch"}
                              </button>
                            </form>

                            {col.status !== "done" ? (
                              <form action={statusAct} onSubmit={() => setLastKey("status")}>
                                <input type="hidden" name="opportunityId" value={i.id} />
                                <input type="hidden" name="status" value={col.status === "new" ? "todo" : "done"} />
                                <button
                                  type="submit"
                                  data-testid="outreach-move-btn"
                                  disabled={statusPending}
                                  className="btn-primary !px-2 !py-0.5 text-[11px]"
                                >
                                  {col.status === "new" ? "→ Todo" : "→ Done"}
                                </button>
                              </form>
                            ) : (
                              <form action={statusAct} onSubmit={() => setLastKey("status")}>
                                <input type="hidden" name="opportunityId" value={i.id} />
                                <input type="hidden" name="status" value="todo" />
                                <button type="submit" disabled={statusPending} className="btn-secondary !px-2 !py-0.5 text-[11px]">
                                  ↺ Reopen
                                </button>
                              </form>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {colItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
                      No opportunities in {col.label}.
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="table-base">
            <thead>
              <tr>
                <th>Opportunity Page</th>
                <th>Domain</th>
                <th>Citation Rate</th>
                <th>Est. Impressions</th>
                <th>AI Citations</th>
                <th>Author / Contact</th>
                <th>Stage</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} data-testid="outreach-table-row">
                  <td className="max-w-sm">
                    <button
                      type="button"
                      onClick={() => setSelectedId(i.id)}
                      className="truncate text-left font-medium text-brand-600 hover:underline"
                    >
                      {i.url}
                    </button>
                  </td>
                  <td>
                    <span className="badge bg-gray-100 text-gray-700">{i.domain}</span>
                  </td>
                  <td className="font-medium text-gray-900">{i.citationPct.toFixed(1)}%</td>
                  <td className="text-gray-600">{i.estimatedImpressions.toLocaleString()}</td>
                  <td className="text-gray-600">{i.citations}</td>
                  <td>
                    {i.authorName ? (
                      <div className="text-xs">
                        <div className="font-medium text-gray-800">{i.authorName}</div>
                        <div className="text-gray-400">{i.authorEmail}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Not looked up</span>
                    )}
                  </td>
                  <td>
                    <span className="badge bg-brand-50 text-brand-700 uppercase">{i.status}</span>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedId(i.id)}
                      className="btn-secondary !px-2.5 !py-1 text-xs"
                    >
                      Inspect & Pitch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected Opportunity Author & Email Pitch Workspace */}
      {selectedItem ? (
        <div data-testid="outreach-editor" className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                  Outreach Pitch Studio
                </span>
                <span className="badge bg-gray-100 text-gray-700">{selectedItem.domain}</span>
                <span className="badge bg-brand-50 text-brand-700 uppercase">{selectedItem.status}</span>
              </div>
              <a
                href={selectedItem.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-sm font-semibold text-gray-900 hover:text-brand-600 hover:underline"
              >
                {selectedItem.url} ↗
              </a>
            </div>

            {props.canWrite ? (
              <div className="flex items-center gap-2">
                <form action={authorAct} onSubmit={() => setLastKey("author")}>
                  <input type="hidden" name="opportunityId" value={selectedItem.id} />
                  <button type="submit" disabled={authorPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                    🔍 Find Author Contact
                  </button>
                </form>
                <form action={draftAct} onSubmit={() => setLastKey("draft")}>
                  <input type="hidden" name="opportunityId" value={selectedItem.id} />
                  <button type="submit" disabled={draftPending} className="btn-primary !px-3 !py-1.5 text-xs">
                    ✉ Generate AI Pitch Email
                  </button>
                </form>
                <form action={deleteAct} onSubmit={() => setLastKey("delete")}>
                  <input type="hidden" name="opportunityId" value={selectedItem.id} />
                  <button type="submit" disabled={deletePending} className="text-xs text-red-500 hover:underline px-2">
                    Delete
                  </button>
                </form>
              </div>
            ) : null}
          </div>

          <form
            key={`${selectedItem.id}-${selectedItem.authorEmail ?? ""}-${selectedItem.emailDraft?.length ?? 0}`}
            action={detailsAct}
            onSubmit={() => setLastKey("details")}
            className="space-y-3"
          >
            <input type="hidden" name="opportunityId" value={selectedItem.id} />
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-700">Author / Editor Name</label>
                <input
                  name="authorName"
                  defaultValue={selectedItem.authorName ?? ""}
                  placeholder="Click 'Find Author Contact' or enter name"
                  readOnly={!props.canWrite}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">Author / Desk Email</label>
                <input
                  name="authorEmail"
                  defaultValue={selectedItem.authorEmail ?? ""}
                  placeholder="editor@publication.com"
                  readOnly={!props.canWrite}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">Outreach Notes</label>
                <input
                  name="notes"
                  defaultValue={selectedItem.notes ?? ""}
                  placeholder="Follow-up dates, placement status…"
                  readOnly={!props.canWrite}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700">
                Personalized Outreach Pitch Email (Grounded in Knowledge Base Facts & Citation Rate)
              </label>
              <textarea
                name="emailDraft"
                defaultValue={selectedItem.emailDraft ?? ""}
                rows={9}
                placeholder="Click 'Generate AI Pitch Email' to draft a personalized pitch citing your verified brand facts…"
                readOnly={!props.canWrite}
                className="mt-1 w-full rounded-xl border border-gray-200 p-3 font-sans text-xs leading-relaxed text-gray-800"
              />
            </div>

            {props.canWrite ? (
              <div className="flex justify-end">
                <button type="submit" disabled={detailsPending} className="btn-primary !px-4 !py-1.5 text-xs">
                  {detailsPending ? "Saving…" : "Save Contact & Pitch Draft"}
                </button>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
