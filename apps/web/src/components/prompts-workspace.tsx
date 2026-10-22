"use client";

import { useMemo, useState } from "react";

interface PromptRow {
  id: string;
  text: string;
  topic: string;
  type: string;
  status: string;
}

/** Prompts workspace: universe / topics / personas / locations / schedules / discover. */
export function PromptsWorkspace(props: { prompts: PromptRow[]; topics: { id: string; name: string }[] }) {
  const [tab, setTab] = useState("prompts");
  const [rows, setRows] = useState(props.prompts);
  const [newPrompt, setNewPrompt] = useState("");
  const [discoverResults, setDiscoverResults] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const topics = useMemo(() => [...new Set(rows.map((r) => r.topic))], [rows]);
  const addPrompt = () => {
    if (!newPrompt.trim()) return;
    setRows((r) => [
      { id: `n${Date.now()}`, text: newPrompt.trim(), topic: topics[0] ?? "Uncategorized", type: "non_branded", status: "active" },
      ...r,
    ]);
    setNewPrompt("");
  };

  const runDiscover = async () => {
    setDiscovering(true);
    try {
      const res = await fetch("/api/prompts/discover", { method: "POST" });
      const data = (await res.json()) as { suggestions: string[] };
      setDiscoverResults(data.suggestions);
    } finally {
      setDiscovering(false);
    }
  };

  const TABS = [
    ["prompts", "Prompt Universe"],
    ["topics", "Topics"],
    ["personas", "Personas"],
    ["locations", "Locations"],
    ["schedules", "Schedules"],
    ["discover", "Discover"],
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-100 px-6">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2.5 text-sm transition ${
              tab === id ? "border-brand-600 font-medium text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {tab === "prompts" ? (
          <>
            <div className="mb-4 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Add a prompt to track…"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPrompt()}
              />
              <button className="btn-primary" onClick={addPrompt}>
                + Track prompt
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Prompt</th>
                    <th>Topic</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-md truncate">{r.text}</td>
                      <td>
                        <span className="badge bg-gray-100 text-gray-600">{r.topic}</span>
                      </td>
                      <td>
                        <span className={`badge ${r.type === "branded" ? "bg-brand-50 text-brand-600" : "bg-purple-50 text-purple-600"}`}>
                          {r.type}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${r.status === "active" ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-500"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          className="text-xs text-gray-400 hover:text-red-500"
                          onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === "topics" ? (
          <div className="grid gap-3 md:grid-cols-3">
            {props.topics.map((t) => (
              <div key={t.id} className="metric-card">
                <div className="text-sm font-medium text-gray-900">{t.name}</div>
                <div className="mt-1 text-xs text-gray-400">{rows.filter((r) => r.topic === t.name).length} prompts</div>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "personas" ? (
          <EmptyState label="Personas" hint="Target prompts by buyer persona (e.g. 'CMO evaluating tools')." />
        ) : null}
        {tab === "locations" ? (
          <EmptyState label="Locations" hint="Country-level tracking for regional AI surfaces." />
        ) : null}
        {tab === "schedules" ? (
          <div className="metric-card max-w-md">
            <div className="text-sm font-semibold text-gray-900">Default</div>
            <div className="text-xs text-gray-400">Daily · includes all pre-cutover history</div>
            <button className="btn-secondary mt-3 text-xs">+ Custom schedule</button>
          </div>
        ) : null}

        {tab === "discover" ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <button className="btn-primary" onClick={runDiscover} disabled={discovering}>
                {discovering ? "Discovering…" : "Run discovery"}
              </button>
              <span className="text-xs text-gray-400">
                Scans your site, search data, social signals and competitor gaps for prompts worth tracking.
              </span>
            </div>
            {discoverResults.length ? (
              <div className="space-y-2">
                {discoverResults.map((s) => (
                  <div key={s} className="flex items-center justify-between rounded-lg border border-gray-100 p-3 text-sm">
                    <span>{s}</span>
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setDiscoverResults((r) => r.filter((x) => x !== s))}>
                      Track
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState label="No discovery run yet" hint="Run discovery to surface AI-suggested prompt candidates." />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center">
      <div className="text-sm font-medium text-gray-700">{label}</div>
      <div className="mt-1 text-xs text-gray-400">{hint}</div>
      <button className="btn-secondary mt-4">+ Add</button>
    </div>
  );
}
