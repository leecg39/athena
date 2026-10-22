"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Daily {
  date: string;
  mentionRate: number;
  citationRate: number;
  avgPosition: number | null;
  shareOfVoice: number;
}
interface DailyModel {
  date: string;
  model: string;
  mentionRate: number;
  citationRate: number;
  avgPosition: number | null;
}
interface DailyEntity {
  date: string;
  name: string;
  shareOfVoice: number;
}

type Metric = "mentionRate" | "citationRate" | "shareOfVoice" | "avgPosition";
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: "mentionRate", label: "Mention rate", unit: "%" },
  { id: "citationRate", label: "Citation rate", unit: "%" },
  { id: "shareOfVoice", label: "Share of voice", unit: "%" },
  { id: "avgPosition", label: "Avg position", unit: "" },
];
const PALETTE = ["#4f39f6", "#10a37f", "#20808d", "#d97757", "#4796e3", "#f97316", "#111827", "#e11d48", "#8b5cf6"];

export function TrendChart({
  daily,
  dailyByModel,
  dailyEntities,
  mode,
  labels,
}: {
  daily: Daily[];
  dailyByModel: DailyModel[];
  dailyEntities: DailyEntity[];
  mode: "detailed" | "simple";
  labels: Record<string, string>;
}) {
  const [metric, setMetric] = useState<Metric>("mentionRate");
  const { rows, series } = useMemo(() => {
    if (mode === "simple") return { rows: daily.map((d) => ({ date: d.date, Overall: d[metric] })), series: ["Overall"] };
    if (metric === "shareOfVoice") {
      const names = [...new Set(dailyEntities.map((e) => e.name))];
      const byDate = new Map<string, Record<string, number | string>>();
      for (const e of dailyEntities) byDate.set(e.date, { ...(byDate.get(e.date) ?? { date: e.date }), [e.name]: e.shareOfVoice });
      return { rows: [...byDate.values()], series: names };
    }
    const models = [...new Set(dailyByModel.map((d) => d.model))];
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const d of dailyByModel) byDate.set(d.date, { ...(byDate.get(d.date) ?? { date: d.date }), [labels[d.model] ?? d.model]: d[metric] });
    return { rows: [...byDate.values()], series: models.map((m) => labels[m] ?? m) };
  }, [daily, dailyByModel, dailyEntities, metric, mode, labels]);
  const unit = METRICS.find((m) => m.id === metric)?.unit ?? "";

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Chart metric">
        {METRICS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={metric === m.id}
            onClick={() => setMetric(m.id)}
            className={`rounded-lg px-3 py-1 text-xs ${metric === m.id ? "bg-brand-50 font-medium text-brand-600" : "text-gray-500 hover:bg-gray-50"}`}
          >
            {m.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400">{mode === "detailed" ? (metric === "shareOfVoice" ? "by brand" : "by AI model") : "all models"}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">No data in this period.</p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                reversed={metric === "avgPosition"}
                domain={metric === "avgPosition" ? [1, "auto"] : [0, 100]}
                tickFormatter={(v: number) => `${v}${unit}`}
              />
              <Tooltip formatter={(v) => (v === null || v === undefined ? "—" : `${v}${unit}`)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {series.map((s, i) => (
                <Line key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {metric === "avgPosition" ? <p className="mt-2 text-[11px] text-gray-400">Lower is better — 1 means the brand is listed first.</p> : null}
    </div>
  );
}
