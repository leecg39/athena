"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

interface SankeyData {
  nodes: { name: string; kind: string }[];
  links: { source: number; target: number; value: number }[];
}

const COLOR: Record<string, string> = { source: "#94a3b8", brand: "#4f39f6", competitor: "#f97316" };

function Node(props: { x: number; y: number; width: number; height: number; payload: { name: string; kind: string } }) {
  const { x, y, width, height, payload } = props;
  const isSource = payload.kind === "source";
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={COLOR[payload.kind] ?? "#94a3b8"} rx={2} />
      <text x={isSource ? x - 6 : x + width + 6} y={y + height / 2} textAnchor={isSource ? "end" : "start"} dominantBaseline="middle" fontSize={11} fill="#374151">
        {payload.name}
      </text>
    </g>
  );
}

export function SourceSankey({ data }: { data: SankeyData }) {
  if (!data.links.length) return <p className="py-16 text-center text-sm text-gray-400">No cited sources with brand mentions in this period.</p>;
  return (
    <div className="h-[460px]">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey data={data} node={Node as never} nodePadding={18} margin={{ left: 160, right: 160, top: 10, bottom: 10 }} link={{ stroke: "#c7d2fe" }}>
          <Tooltip />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
