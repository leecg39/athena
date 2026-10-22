"use client";

import { useState } from "react";
import type { DemoSource } from "@/lib/demo";

const TYPE_STYLE: Record<string, { label: string; cls: string }> = {
  C: { label: "C", cls: "bg-orange-500" },
  T: { label: "T", cls: "bg-purple-500" },
  O: { label: "O", cls: "bg-blue-500" },
  P: { label: "P", cls: "bg-pink-500" },
};

function Spark({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const w = 90;
  const h = 24;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - (p / max) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={d} fill="none" stroke="#f97316" strokeWidth="1.5" />
    </svg>
  );
}

/** Source domain ranking — reimplementation of the observed Sources table. */
export function SourcesTable({ sources }: { sources: DemoSource[] }) {
  const [selected, setSelected] = useState<DemoSource | null>(null);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Domain ↕</th>
              <th>Sparkchart</th>
              <th>Citation % ↕</th>
              <th>Brand mention %</th>
              <th>Responses Influenced</th>
              <th>Type</th>
              <th>Competitor Mention %</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s, i) => (
              <tr key={s.domain} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelected(s)}>
                <td className="text-gray-400">{i + 1}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-500">
                      {s.domain[0].toUpperCase()}
                    </span>
                    <span className="text-brand-600">{s.domain}</span>
                  </span>
                </td>
                <td>
                  <Spark points={s.spark} />
                </td>
                <td className="font-medium">{s.citationPct.toFixed(2)}%</td>
                <td>{s.brandMentionPct.toFixed(2)}%</td>
                <td className="text-gray-500">{s.responsesInfluenced}</td>
                <td>
                  <span className={`badge text-white ${TYPE_STYLE[s.type].cls}`}>{TYPE_STYLE[s.type].label}</span>
                </td>
                <td>{s.competitorMentionPct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/20" onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-semibold">{selected.domain}</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <dl className="space-y-3 text-sm">
              <Row k="Type" v={TYPE_STYLE[selected.type].label} />
              <Row k="Citation rate" v={`${selected.citationPct.toFixed(2)}%`} />
              <Row k="Brand mention rate" v={`${selected.brandMentionPct.toFixed(2)}%`} />
              <Row k="Responses influenced" v={selected.responsesInfluenced} />
              <Row k="Competitor mention rate" v={`${selected.competitorMentionPct.toFixed(2)}%`} />
            </dl>
            <div className="mt-4 rounded-lg bg-brand-50 p-3 text-xs text-brand-700">
              Standalone URL inspector: paste any URL on this domain to inspect how AI engines cite it.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-medium text-gray-900">{v}</dd>
    </div>
  );
}
