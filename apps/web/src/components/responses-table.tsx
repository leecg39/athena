"use client";

import { useMemo, useState } from "react";
import type { DemoResponse } from "@/lib/demo";

const MODEL_BADGE: Record<string, string> = {
  ChatGPT: "bg-emerald-50 text-emerald-700",
  Perplexity: "bg-sky-50 text-sky-700",
  Gemini: "bg-blue-50 text-blue-700",
  "AI Mode": "bg-blue-50 text-blue-700",
  Copilot: "bg-teal-50 text-teal-700",
  Grok: "bg-gray-100 text-gray-700",
  "AI Overview": "bg-indigo-50 text-indigo-700",
};

/** Prompt×model response matrix — reimplementation of the observed Responses table. */
export function ResponsesTable({ responses }: { responses: DemoResponse[] }) {
  const [model, setModel] = useState<string>("");
  const [type, setType] = useState<string>("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DemoResponse | null>(null);

  const models = useMemo(() => [...new Set(responses.map((r) => r.model))], [responses]);
  const filtered = responses.filter(
    (r) =>
      (!model || r.model === model) &&
      (!type || r.promptType === type) &&
      (!query || r.prompt.toLowerCase().includes(query.toLowerCase())),
  );

  const exportCsv = () => {
    const header = "prompt,model,mentioned,sources,cited,competitors,type,date\n";
    const body = filtered
      .map((r) => [r.prompt, r.model, r.mentioned, r.sources, r.cited, r.competitorsMentioned.join(" "), r.promptType, r.date].join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "responses.csv";
    a.click();
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search prompts…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input max-w-40" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select className="input max-w-40" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option>Branded</option>
          <option>Non-Branded</option>
        </select>
        <button className="btn-secondary ml-auto" onClick={exportCsv}>
          ⬇ CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="table-base">
          <thead>
            <tr>
              <th>Prompt</th>
              <th>Model</th>
              <th>Mentioned</th>
              <th>Sources</th>
              <th>Attributed Citation</th>
              <th>Competitors Mentioned</th>
              <th>Cited</th>
              <th>Prompt Type</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelected(r)}>
                <td className="max-w-xs truncate text-brand-600">{r.prompt}</td>
                <td>
                  <span className={`badge ${MODEL_BADGE[r.model] ?? "bg-gray-100 text-gray-600"}`}>{r.model}</span>
                </td>
                <td>
                  <Pill on={r.mentioned} />
                </td>
                <td>
                  <Pill on={r.sources} />
                </td>
                <td>
                  <Pill on={r.attributedCitation} />
                </td>
                <td>
                  {r.competitorsMentioned.length ? (
                    <span className="text-gray-700">{r.competitorsMentioned.join(", ")}</span>
                  ) : (
                    <Pill on={false} />
                  )}
                </td>
                <td>
                  <Pill on={r.cited} />
                </td>
                <td>
                  <span className={`badge ${r.promptType === "Branded" ? "bg-brand-50 text-brand-600" : "bg-purple-50 text-purple-600"}`}>
                    {r.promptType}
                  </span>
                </td>
                <td className="text-gray-500">{r.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/20" onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-md font-semibold text-gray-900">{selected.prompt}</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <span className={`badge ${MODEL_BADGE[selected.model] ?? "bg-gray-100"}`}>{selected.model}</span>
              <span className="badge bg-gray-100 text-gray-600">{selected.promptType}</span>
              <span className="badge bg-gray-100 text-gray-600">{selected.date}</span>
            </div>
            <div className="rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">{selected.snippet}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Pill({ on }: { on: boolean }) {
  return (
    <span className={`badge ${on ? "bg-brand-50 text-brand-600" : "bg-orange-50 text-orange-500"}`}>{on ? "Yes" : "No"}</span>
  );
}
