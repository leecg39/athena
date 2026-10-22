"use client";

import { useState } from "react";

const KIND_BADGE: Record<string, string> = {
  opportunity: "bg-emerald-50 text-emerald-600",
  gap: "bg-orange-50 text-orange-600",
  competitor_move: "bg-purple-50 text-purple-600",
  integrity: "bg-red-50 text-red-500",
};

export function InsightsList(props: {
  insights: { id: string; title: string; body: string; kind: string; status: string }[];
}) {
  const [items, setItems] = useState(props.insights);

  const setStatus = (id: string, status: string) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, status } : i)));
  };

  return (
    <div className="space-y-3">
      {items
        .filter((i) => i.status === "active")
        .map((i) => (
          <div key={i.id} className="metric-card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${KIND_BADGE[i.kind] ?? "bg-gray-100 text-gray-600"}`}>{i.kind.replace("_", " ")}</span>
                  <h3 className="text-sm font-semibold text-gray-900">{i.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{i.body}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => setStatus(i.id, "resolved")}>
                  Act on it
                </button>
                <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setStatus(i.id, "resolved")}>
                  Resolve
                </button>
                <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setStatus(i.id, "discarded")}>
                  Discard
                </button>
              </div>
            </div>
          </div>
        ))}
      {items.filter((i) => i.status === "active").length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
          No active insights. New insights are generated every 6 hours from your metrics.
        </div>
      ) : null}
    </div>
  );
}
