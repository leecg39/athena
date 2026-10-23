"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ContentStatus, CmsProvider } from "@athena/core/content";
import type { ActionState } from "@/lib/action-state";
import {
  createContentItemAction,
  importContentUrlAction,
  updateContentItemAction,
  deleteContentItemAction,
  generateBriefAction,
  approveBriefAction,
  generateDraftAction,
  saveVersionAction,
} from "@/app/(app)/content/actions";
import { CmsPanel, type SerializedPublishTarget } from "@/components/content/cms-panel";
import { PublishTab } from "@/components/content/publish-tab";
import { ReviseTab } from "@/components/content/revise-tab";

const idle: ActionState = { ok: false };

const CMS_OPTIONS: { value: CmsProvider; label: string }[] = [
  { value: "wordpress", label: "WordPress" },
  { value: "webflow", label: "Webflow" },
  { value: "contentful", label: "Contentful" },
  { value: "sanity", label: "Sanity" },
  { value: "wix", label: "Wix" },
  { value: "framer", label: "Framer" },
  { value: "payload", label: "Payload CMS" },
  { value: "shopify", label: "Shopify" },
];

const STATUS_BADGE: Record<ContentStatus, string> = {
  idea: "bg-gray-100 text-gray-600",
  brief: "bg-blue-50 text-blue-700",
  draft: "bg-amber-50 text-amber-700",
  review: "bg-purple-50 text-purple-700",
  approved: "bg-teal-50 text-teal-700",
  published: "bg-emerald-50 text-emerald-700",
};

export interface SerializedContentVersion {
  id: string;
  version: number;
  body: string;
  createdAt: string;
}

export interface SerializedContentItem {
  id: string;
  title: string;
  targetUrl: string | null;
  promptId: string | null;
  promptText: string | null;
  status: ContentStatus;
  columns: Record<string, string | number | boolean>;
  agentStage: "idle" | "brief_ready" | "draft_ready" | "revised" | "published";
  citations30d: number;
  latestBrief: {
    id: string;
    body: string;
    approvedAt: string | null;
    createdAt: string;
  } | null;
  latestDraft: {
    id: string;
    body: string;
    createdAt: string;
  } | null;
  versions: SerializedContentVersion[];
  createdAt: string;
}

export type { SerializedPublishTarget };

export function ContentGrid(props: {
  websiteDomain: string;
  items: SerializedContentItem[];
  counts: {
    idea: number;
    brief: number;
    draft: number;
    review: number;
    approved: number;
    published: number;
    total: number;
  };
  publishTargets: SerializedPublishTarget[];
  prompts: { id: string; text: string }[];
  canWrite: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<ContentStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [activePanel, setActivePanel] = useState<"new" | "import" | "cms" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(props.items[0]?.id ?? null);
  const [drawerTab, setDrawerTab] = useState<"brief" | "draft" | "revise" | "publish">("draft");
  const [selectedVersionNum, setSelectedVersionNum] = useState<number | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string>("revise");

  const [createState, createAct, createPending] = useActionState(createContentItemAction, idle);
  const [importState, importAct, importPending] = useActionState(importContentUrlAction, idle);
  const [updateState, updateAct, updatePending] = useActionState(updateContentItemAction, idle);
  const [deleteState, deleteAct, deletePending] = useActionState(deleteContentItemAction, idle);
  const [briefState, briefAct, briefPending] = useActionState(generateBriefAction, idle);
  const [approveBriefState, approveBriefAct, approveBriefPending] = useActionState(approveBriefAction, idle);
  const [draftState, draftAct, draftPending] = useActionState(generateDraftAction, idle);
  const [saveVerState, saveVerAct, saveVerPending] = useActionState(saveVersionAction, idle);

  const stateMap: Record<string, ActionState> = {
    create: createState,
    import: importState,
    update: updateState,
    delete: deleteState,
    brief: briefState,
    approveBrief: approveBriefState,
    draft: draftState,
    saveVer: saveVerState,
  };
  const orderedStates = [
    stateMap[lastKey] ?? idle,
    ...Object.entries(stateMap)
      .filter(([k]) => k !== lastKey)
      .map(([, v]) => v),
  ];
  const errorMsg = orderedStates.find((s) => s.error)?.error;
  const infoMsg = orderedStates.find((s) => s.message)?.message;

  const filteredItems = props.items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${item.title} ${item.targetUrl ?? ""} ${item.promptText ?? ""} ${Object.values(item.columns).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const selectedItem = props.items.find((i) => i.id === selectedId) ?? filteredItems[0] ?? null;
  const activeVersion =
    selectedItem?.versions.find((v) => v.version === selectedVersionNum) ?? selectedItem?.versions[0] ?? null;


  const statusTabs: { key: ContentStatus | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: props.counts.total },
    { key: "idea", label: "Idea", count: props.counts.idea },
    { key: "brief", label: "Brief", count: props.counts.brief },
    { key: "draft", label: "Draft", count: props.counts.draft },
    { key: "review", label: "In Review", count: props.counts.review },
    { key: "approved", label: "Approved", count: props.counts.approved },
    { key: "published", label: "Published", count: props.counts.published },
  ];

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Content status filter">
          {statusTabs.map((t) => {
            const active = statusFilter === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active ? "bg-brand-600 text-white shadow-xs" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span>{t.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter spreadsheet rows…"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
          />
          {props.canWrite ? (
            <>
              <button
                type="button"
                data-testid="content-cms-btn"
                onClick={() => setActivePanel(activePanel === "cms" ? null : "cms")}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                CMS Connectors ({props.publishTargets.length}/8)
              </button>
              <button
                type="button"
                data-testid="content-import-btn"
                onClick={() => setActivePanel(activePanel === "import" ? null : "import")}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                Import URL
              </button>
              <button
                type="button"
                data-testid="content-new-btn"
                onClick={() => setActivePanel(activePanel === "new" ? null : "new")}
                className="btn-primary !px-3 !py-1.5 text-xs"
              >
                + New content
              </button>
            </>
          ) : null}
          <Link href="/content/catalog-optimization" className="btn-secondary !px-3 !py-1.5 text-xs">
            Catalog Optimization (Shopify) →
          </Link>
        </div>
      </div>

      {/* Status & Error Banners */}
      {errorMsg ? (
        <div role="alert" data-testid="content-error-banner" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      ) : null}
      {!errorMsg && infoMsg ? (
        <div role="status" data-testid="content-status-banner" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {infoMsg}
        </div>
      ) : null}

      {/* Expandable Panel: Create New Content Item */}
      {activePanel === "new" && props.canWrite ? (
        <form
          action={createAct}
          onSubmit={() => {
            setLastKey("create");
            setActivePanel(null);
          }}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Add New Content Row</div>
            <button type="button" onClick={() => setActivePanel(null)} className="text-xs text-gray-400 hover:text-gray-600">
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input
              name="title"
              required
              placeholder="Article or landing page title"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-2"
            />
            <input
              name="targetUrl"
              placeholder={`https://${props.websiteDomain}/blog/slug (optional)`}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <select name="promptId" defaultValue="" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <option value="">Link to tracked prompt (optional)</option>
              {props.prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.text}
                </option>
              ))}
            </select>
            <input
              name="contentType"
              defaultValue="Comparison Guide"
              placeholder="Format (e.g. Comparison Guide, Pillar)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <input
              name="targetKeyword"
              placeholder="Target AI query / keyword"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <input
              name="persona"
              defaultValue="Product & Design Leaders"
              placeholder="Target persona"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
            />
            <button type="submit" disabled={createPending} className="btn-primary !px-3 !py-1.5 text-xs">
              {createPending ? "Creating…" : "Add to Content Grid"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Expandable Panel: Import URL */}
      {activePanel === "import" && props.canWrite ? (
        <form
          action={importAct}
          onSubmit={() => {
            setLastKey("import");
            setActivePanel(null);
          }}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Import Existing URL for Athena Revision
            </div>
            <button type="button" onClick={() => setActivePanel(null)} className="text-xs text-gray-400 hover:text-gray-600">
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <input
              name="url"
              required
              placeholder={`https://${props.websiteDomain}/features`}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm md:col-span-2"
            />
            <input
              name="title"
              placeholder="Page title (optional)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <input
                name="targetKeyword"
                placeholder="Target keyword (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <button type="submit" disabled={importPending} className="btn-primary shrink-0 !px-3 !py-2 text-xs">
                {importPending ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {activePanel === "cms" && props.canWrite ? <CmsPanel targets={props.publishTargets} onClose={() => setActivePanel(null)} /> : null}

      {/* Spreadsheet-style Content Hub Grid */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="table-base">
          <thead>
            <tr>
              <th>Title & Target URL</th>
              <th>Format & Keyword</th>
              <th>AI Agent Pipeline (Brief → Draft → Version)</th>
              <th>Status</th>
              <th>Citations (30d)</th>
              <th>CMS Publish</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((r) => {
              const isSelected = selectedItem?.id === r.id;
              const isEditingRow = editingRowId === r.id;
              const latestVerNum = r.versions[0]?.version ?? 0;

              return (
                <tr
                  key={r.id}
                  data-testid="content-row"
                  data-status={r.status}
                  className={isSelected ? "bg-brand-50/30" : undefined}
                >
                  <td className="max-w-md">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(r.id);
                        setSelectedVersionNum(null);
                      }}
                      className="text-left font-medium text-brand-600 hover:underline"
                    >
                      {r.title}
                    </button>
                    {r.targetUrl ? (
                      <div className="mt-0.5 truncate text-xs text-gray-400">{r.targetUrl}</div>
                    ) : null}
                    {r.promptText ? (
                      <div className="mt-0.5 text-[11px] text-gray-500">Prompt: “{r.promptText}”</div>
                    ) : null}

                    {isEditingRow && props.canWrite ? (
                      <form
                        action={updateAct}
                        onSubmit={() => {
                          setLastKey("update");
                          setEditingRowId(null);
                        }}
                        className="mt-2 grid gap-1.5 border-t border-gray-100 pt-2"
                      >
                        <input type="hidden" name="contentId" value={r.id} />
                        <input
                          name="title"
                          defaultValue={r.title}
                          required
                          className="rounded border border-gray-200 px-2 py-1 text-xs"
                        />
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            name="contentType"
                            defaultValue={String(r.columns.contentType || "Article")}
                            placeholder="Format"
                            className="rounded border border-gray-200 px-2 py-1 text-xs"
                          />
                          <input
                            name="targetKeyword"
                            defaultValue={String(r.columns.targetKeyword || "")}
                            placeholder="Target keyword"
                            className="rounded border border-gray-200 px-2 py-1 text-xs"
                          />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => setEditingRowId(null)} className="text-xs text-gray-400">
                            Cancel
                          </button>
                          <button type="submit" disabled={updatePending} className="btn-primary !px-2.5 !py-1 text-xs">
                            Save cell
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </td>

                  <td>
                    <div className="flex flex-col gap-1">
                      <span className="badge w-fit bg-gray-100 text-gray-700">
                        {String(r.columns.contentType || "Article")}
                      </span>
                      <span className="text-xs text-gray-500">
                        {String(r.columns.targetKeyword || "—")}
                      </span>
                      {props.canWrite && !isEditingRow ? (
                        <button
                          type="button"
                          onClick={() => setEditingRowId(r.id)}
                          className="w-fit text-[11px] text-brand-600 hover:underline"
                        >
                          Edit cells
                        </button>
                      ) : null}
                    </div>
                  </td>

                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(r.id);
                          setDrawerTab("brief");
                        }}
                        className={`badge cursor-pointer ${
                          r.latestBrief ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        1. Brief {r.latestBrief ? "✓" : "○"}
                      </button>
                      <span className="text-xs text-gray-300">→</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(r.id);
                          setDrawerTab("draft");
                        }}
                        className={`badge cursor-pointer ${
                          r.latestDraft ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        2. Draft {r.latestDraft ? "✓" : "○"}
                      </button>
                      <span className="text-xs text-gray-300">→</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(r.id);
                          setDrawerTab("draft");
                        }}
                        className={`badge cursor-pointer ${
                          latestVerNum > 0 ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        3. {latestVerNum > 0 ? `v${latestVerNum}` : "v0"}
                      </button>
                    </div>

                    {props.canWrite ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {!r.latestBrief ? (
                          <form action={briefAct} onSubmit={() => setLastKey("brief")}>
                            <input type="hidden" name="contentId" value={r.id} />
                            <button type="submit" disabled={briefPending} className="text-[11px] font-medium text-brand-600 hover:underline">
                              + Generate Brief
                            </button>
                          </form>
                        ) : !r.latestDraft ? (
                          <form action={draftAct} onSubmit={() => setLastKey("draft")}>
                            <input type="hidden" name="contentId" value={r.id} />
                            <button type="submit" disabled={draftPending} className="text-[11px] font-medium text-brand-600 hover:underline">
                              + Generate Draft
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </td>

                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {r.status}
                    </span>
                    {r.columns.publishedProvider ? (
                      <div className="mt-0.5 text-[11px] text-emerald-600">
                        via {CMS_OPTIONS.find((c) => c.value === r.columns.publishedProvider)?.label ?? String(r.columns.publishedProvider)}
                      </div>
                    ) : null}
                  </td>

                  <td className="text-gray-600">{r.citations30d || "—"}</td>

                  <td>
                    <button type="button" onClick={() => { setSelectedId(r.id); setDrawerTab("publish"); }} className="text-xs text-brand-600 hover:underline">
                      {r.status === "published" ? "Published ✓" : "Publish…"}
                    </button>
                  </td>

                  <td className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(r.id);
                          setDrawerTab("revise");
                        }}
                        className="btn-secondary !px-2.5 !py-1 text-xs"
                      >
                        Open Studio
                      </button>
                      {props.canWrite ? (
                        <form action={deleteAct} onSubmit={() => setLastKey("delete")}>
                          <input type="hidden" name="contentId" value={r.id} />
                          <button type="submit" disabled={deletePending} className="text-xs text-red-500 hover:underline px-1">
                            Delete
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-gray-400">
                  No content items match this filter. Click “+ New content” or “Import URL” to add one.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* AI Agent Studio Drawer for Selected Content Item */}
      {selectedItem ? (
        <div data-testid="content-drawer" className="rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">AI Content Studio</span>
                <span className={`badge ${STATUS_BADGE[selectedItem.status]}`}>{selectedItem.status}</span>
                {selectedItem.versions.length > 0 ? (
                  <span className="badge bg-gray-100 text-gray-700">
                    Latest v{selectedItem.versions[0]?.version}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-1 text-base font-semibold text-gray-900">{selectedItem.title}</h3>
            </div>

            <div className="flex gap-1" role="tablist" aria-label="AI Content Studio tabs">
              {(
                [
                  ["brief", `1. AI Content Brief ${selectedItem.latestBrief?.approvedAt ? "(Approved)" : ""}`],
                  ["draft", `2. Draft & Versions (${selectedItem.versions.length})`],
                  ["revise", `3. Revise with Athena`],
                  ["publish", `4. Publish`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={drawerTab === key}
                  onClick={() => setDrawerTab(key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    drawerTab === key ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5">
            {drawerTab === "brief" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-gray-500">
                    Grounded in verified Knowledge Base facts, internal link pages, and tracked prompts.
                  </div>
                  {props.canWrite ? (
                    <div className="flex items-center gap-2">
                      <form action={briefAct} onSubmit={() => setLastKey("brief")} className="flex items-center gap-2">
                        <input type="hidden" name="contentId" value={selectedItem.id} />
                        <input
                          name="focusNotes"
                          placeholder="Focus notes (optional)"
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs"
                        />
                        <button type="submit" disabled={briefPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                          {briefPending ? "Generating…" : selectedItem.latestBrief ? "Regenerate Brief" : "Generate AI Brief"}
                        </button>
                      </form>
                      {selectedItem.latestBrief && !selectedItem.latestBrief.approvedAt ? (
                        <form action={approveBriefAct} onSubmit={() => setLastKey("approveBrief")}>
                          <input type="hidden" name="contentId" value={selectedItem.id} />
                          <input type="hidden" name="briefId" value={selectedItem.latestBrief.id} />
                          <button type="submit" disabled={approveBriefPending} className="btn-primary !px-3 !py-1.5 text-xs">
                            Approve Brief →
                          </button>
                        </form>
                      ) : null}
                      {selectedItem.latestBrief ? (
                        <form
                          action={draftAct}
                          onSubmit={() => {
                            setLastKey("draft");
                            setDrawerTab("draft");
                          }}
                        >
                          <input type="hidden" name="contentId" value={selectedItem.id} />
                          <input type="hidden" name="briefId" value={selectedItem.latestBrief.id} />
                          <button type="submit" disabled={draftPending} className="btn-primary !px-3 !py-1.5 text-xs">
                            {draftPending ? "Drafting…" : "Generate Full Draft →"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {selectedItem.latestBrief ? (
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50/70 p-4 font-sans text-xs leading-relaxed text-gray-800">
                    {selectedItem.latestBrief.body}
                  </pre>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-xs text-gray-400">
                    No brief generated yet. Click “Generate AI Brief” above to synthesize an AEO brief from your Knowledge Base.
                  </div>
                )}
              </div>
            ) : null}

            {drawerTab === "draft" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-500">Version history:</span>
                    {selectedItem.versions.map((v) => {
                      const active = (activeVersion?.version ?? 0) === v.version;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelectedVersionNum(v.version)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                            active ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          v{v.version}
                        </button>
                      );
                    })}
                    {selectedItem.versions.length === 0 ? (
                      <span className="text-xs text-gray-400">No versions yet</span>
                    ) : null}
                  </div>

                  {props.canWrite ? (
                    <form action={draftAct} onSubmit={() => setLastKey("draft")}>
                      <input type="hidden" name="contentId" value={selectedItem.id} />
                      <button type="submit" disabled={draftPending} className="btn-secondary !px-3 !py-1.5 text-xs">
                        {draftPending ? "Generating…" : "+ Generate AI Draft Version"}
                      </button>
                    </form>
                  ) : null}
                </div>

                {activeVersion ? (
                  <form
                    key={`${selectedItem.id}-v${activeVersion.version}`}
                    action={saveVerAct}
                    onSubmit={() => {
                      setLastKey("saveVer");
                      setSelectedVersionNum(null);
                    }}
                    className="space-y-3"
                  >
                    <input type="hidden" name="contentId" value={selectedItem.id} />
                    <textarea
                      name="body"
                      defaultValue={activeVersion.body}
                      rows={12}
                      readOnly={!props.canWrite}
                      className="w-full rounded-xl border border-gray-200 p-4 font-mono text-xs leading-relaxed text-gray-800"
                    />
                    {props.canWrite ? (
                      <div className="flex items-center justify-between">
                        <select
                          name="status"
                          defaultValue={selectedItem.status}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs"
                        >
                          <option value="draft">Keep status: Draft</option>
                          <option value="review">Move to: In Review</option>
                          <option value="approved">Move to: Approved</option>
                        </select>
                        <button type="submit" disabled={saveVerPending} className="btn-primary !px-3 !py-1.5 text-xs">
                          {saveVerPending ? "Saving…" : `Save Edits as v${(selectedItem.versions[0]?.version ?? 0) + 1}`}
                        </button>
                      </div>
                    ) : null}
                  </form>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-xs text-gray-400">
                    No draft version yet. Click “+ Generate AI Draft Version” or “✎ Revise with Athena”.
                  </div>
                )}
              </div>
            ) : null}

            {drawerTab === "publish" ? (
              <PublishTab item={{ id: selectedItem.id, status: selectedItem.status, targetUrl: selectedItem.targetUrl, hasVersion: selectedItem.versions.length > 0 }} targets={props.publishTargets} canWrite={props.canWrite} />
            ) : null}

            {drawerTab === "revise" ? (
              <ReviseTab contentId={selectedItem.id} canWrite={props.canWrite} onRevised={() => { setSelectedVersionNum(null); setDrawerTab("draft"); }} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
