"use client";

import { useState } from "react";

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  confirmed_inaccuracy: { label: "Confirmed inaccuracy", cls: "bg-red-50 text-red-600" },
  kb_inconsistency: { label: "KB inconsistency", cls: "bg-orange-50 text-orange-600" },
  model_disagreement: { label: "Model disagreement", cls: "bg-purple-50 text-purple-600" },
};

export function OracleList(props: { findings: { id: string; type: string; claim: string; evidence: string; models: string[] }[] }) {
  const [items, setItems] = useState(props.findings);

  return (
    <div className="space-y-3">
      {items.map((f) => (
        <div key={f.id} className="metric-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className={`badge ${TYPE_BADGE[f.type]?.cls ?? "bg-gray-100"}`}>{TYPE_BADGE[f.type]?.label ?? f.type}</span>
              <div className="mt-2 text-sm font-medium text-gray-900">{f.claim}</div>
              <div className="mt-1 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">“{f.evidence}”</div>
              <div className="mt-2 flex gap-1">
                {f.models.map((m) => (
                  <span key={m} className="badge bg-gray-100 text-gray-500">
                    {m}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <button className="btn-primary !px-3 !py-1 text-xs" onClick={() => setItems((all) => all.filter((x) => x.id !== f.id))}>
                Resolve
              </button>
              <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => setItems((all) => all.filter((x) => x.id !== f.id))}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}
      {!items.length ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
          No open findings. Oracle scans AI responses against your knowledge base every run.
        </div>
      ) : null}
    </div>
  );
}
