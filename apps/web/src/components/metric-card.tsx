"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface SeriesPoint {
  date: string;
  brand: number;
  competitor?: number;
}

/** Metric card with Detailed/Simple toggle — reimplementation of the observed pattern. */
export function MetricCard(props: {
  title: string;
  subtitle: string;
  value: string;
  suffix?: string;
  data: SeriesPoint[];
  detailed?: boolean;
  invertValue?: boolean;
}) {
  const [mode, setMode] = useState<"detailed" | "simple">("simple");
  const detailed = mode === "detailed" && props.detailed !== false;

  return (
    <div className="metric-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1 text-sm font-semibold text-gray-900">
            {props.title} <span className="cursor-help text-gray-300">ⓘ</span>
          </div>
          <div className="text-xs text-gray-400">{props.subtitle}</div>
        </div>
      </div>
      <div className="mb-2 mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-900">{props.value}</span>
        {props.suffix ? <span className="text-xs text-gray-400">{props.suffix}</span> : null}
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={props.data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="brandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4f39f6" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#4f39f6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 6" stroke="#eee" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(v: string) => v.slice(5)}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} domain={[0, "auto"]} unit="%" width={48} />
            <Tooltip
              formatter={(v: number | string) => `${Number(v).toFixed(1)}%`}
              labelStyle={{ fontSize: 12 }}
              contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #eee" }}
            />
            {detailed ? (
              <Line type="monotone" dataKey="competitor" stroke="#f97316" strokeWidth={2} dot={false} name="Competitor" />
            ) : null}
            <Area type="monotone" dataKey="brand" stroke="#4f39f6" strokeWidth={2.5} fill="url(#brandFill)" name="Brand" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center">
        <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
          {(["detailed", "simple"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 capitalize transition ${
                mode === m ? "bg-white font-medium shadow-sm" : "text-gray-500"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
