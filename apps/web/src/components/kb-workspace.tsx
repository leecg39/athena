"use client";

import { useState } from "react";

/** Knowledge Base workspace: pillars + facts + pending claims queue. */
export function KbWorkspace() {
  const [pillars] = useState([
    { id: "p1", name: "Product & Features", facts: 12 },
    { id: "p2", name: "Pricing & Plans", facts: 6 },
    { id: "p3", name: "Security & Compliance", facts: 4 },
  ]);
  const [claims, setClaims] = useState([
    { id: "f1", claim: "Canvasly supports 50-person workspaces on the free plan", confidence: 0.72 },
    { id: "f2", claim: "Canvasly was founded in 2021", confidence: 0.61 },
  ]);
  const [tab, setTab] = useState("pillars");

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-100 px-6">
        {[
          ["pillars", "Pillars"],
          ["review", `Review pending claims (${claims.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2.5 text-sm ${tab === id ? "border-brand-600 font-medium text-brand-600" : "border-transparent text-gray-500"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-6">
        {tab === "pillars" ? (
          <div className="grid gap-3 md:grid-cols-3">
            {pillars.map((p) => (
              <div key={p.id} className="metric-card cursor-pointer hover:border-brand-600">
                <div className="text-sm font-semibold text-gray-900">{p.name}</div>
                <div className="mt-1 text-xs text-gray-400">{p.facts} verified facts</div>
                <div className="mt-3 flex gap-2 text-[11px] text-brand-600">
                  <button>View document</button>
                  <button>Add fact</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {claims.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                <div>
                  <div className="text-sm text-gray-800">{c.claim}</div>
                  <div className="text-[11px] text-gray-400">confidence {(c.confidence * 100).toFixed(0)}% — auto-extracted, not yet verified</div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-primary !px-3 !py-1 text-xs"
                    onClick={() => setClaims((all) => all.filter((x) => x.id !== c.id))}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-secondary !px-3 !py-1 text-xs"
                    onClick={() => setClaims((all) => all.filter((x) => x.id !== c.id))}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
