import { getTranslations } from "@/lib/i18n/server";
/** Tiny server-rendered sparkline (no client JS). */
export async function Sparkline({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const tt = await getTranslations();
  if (values.length < 2) return <span className="text-[11px] text-gray-300">—</span>;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tt("trend {0}", { 0: values.join(", ") })}>
      <polyline points={points} fill="none" stroke="#4f39f6" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
