"use client";

import { useState } from "react";

const COLUMNS: { status: "new" | "todo" | "done"; label: string }[] = [
  { status: "new", label: "New" },
  { status: "todo", label: "Todo" },
  { status: "done", label: "Done" },
];

type Opp = { id: string; page: string; status: "new" | "todo" | "done"; citationPct: number; impressions: string; citations: string; author?: string; draft?: string };

/** Outreach kanban — reimplementation of the observed pipeline. */
export function OutreachKanban(props: { opportunities: Opp[] }) {
  const [items, setItems] = useState(props.opportunities.map((o) => ({ ...o })));
  const [drafting, setDrafting] = useState<string | null>(null);

  const move = (id: string, status: Opp["status"]) =>
    setItems((all) => all.map((i) => (i.id === id ? { ...i, status } : i)));

  const draft = (id: string) => {
    setDrafting(id);
    setTimeout(() => {
      setItems((all) =>
        all.map((i) =>
          i.id === id
            ? {
                ...i,
                author: i.author ?? "Editorial Team",
                draft: `Hi ${i.author ?? "there"},\n\nI noticed your article cites several design tools but not Canvasly. Our data shows AI assistants recommend Canvasly for product-team workflows — would you consider including it in your piece? Happy to share our latest benchmarks.\n\nBest,\nGrowth Team`,
              }
            : i,
        ),
      );
      setDrafting(null);
    }, 900);
  };

  return (
    <div className="grid grid-cols-3 gap-4">
      {COLUMNS.map((col) => (
        <div key={col.status} className="rounded-xl bg-gray-50 p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-gray-700">{col.label}</span>
            <span className="badge bg-white text-gray-500">{items.filter((i) => i.status === col.status).length}</span>
          </div>
          <div className="space-y-2">
            {items
              .filter((i) => i.status === col.status)
              .map((i) => (
                <div key={i.id} className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="truncate text-sm font-medium text-brand-600">{i.page}</div>
                  <div className="mt-1 flex gap-3 text-[11px] text-gray-400">
                    <span>Citation {i.citationPct}%</span>
                    <span>Impr. {i.impressions}</span>
                    <span>Cit. {i.citations}</span>
                  </div>
                  {i.draft ? (
                    <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] text-gray-600">
                      {i.draft}
                    </pre>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    {col.status !== "done" ? (
                      <button className="btn-secondary !px-2 !py-0.5 text-[11px]" onClick={() => move(i.id, col.status === "new" ? "todo" : "done")}>
                        {col.status === "new" ? "→ Todo" : "→ Done"}
                      </button>
                    ) : null}
                    <button className="btn-secondary !px-2 !py-0.5 text-[11px]" onClick={() => draft(i.id)} disabled={drafting === i.id}>
                      {drafting === i.id ? "Drafting…" : "✉ Draft pitch"}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
