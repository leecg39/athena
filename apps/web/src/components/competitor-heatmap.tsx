"use client";

import { useState } from "react";

/** Competitor heatmap — topic × competitor grid with Mention/Citation toggle. */
export function CompetitorHeatmap(props: {
  topics: string[];
  competitors: string[];
  mention: number[][];
  citation: number[][];
}) {
  const [metric, setMetric] = useState<"mention" | "citation">("mention");
  const matrix = metric === "mention" ? props.mention : props.citation;

  const cellColor = (v: number) => {
    if (v === 0) return "bg-gray-50 text-gray-300";
    const intensity = Math.min(90, 15 + v * 0.75);
    return `bg-[rgba(79,57,246,${intensity / 100})] text-white`;
  };

  return (
    <div className="metric-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">Competitor Heatmap ⓘ</div>
          <div className="text-xs text-gray-400">Brand vs competitor visibility by topic</div>
        </div>
        <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
          {(["mention", "citation"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded-md px-3 py-1 capitalize ${metric === m ? "bg-white font-medium shadow-sm" : "text-gray-500"}`}
            >
              {m === "mention" ? "Mention %" : "Citation %"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th />
              {props.competitors.map((c) => (
                <th key={c} className="text-center">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.topics.map((t, i) => (
              <tr key={t}>
                <td className="whitespace-nowrap text-xs font-medium text-gray-700">{t}</td>
                {matrix[i].map((v, j) => (
                  <td key={j} className="p-1 text-center">
                    <div className={`rounded-md px-2 py-2.5 text-xs font-medium ${cellColor(v)}`}>
                      {v.toFixed(1)}%
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
