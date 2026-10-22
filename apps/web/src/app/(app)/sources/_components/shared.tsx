import type { SourceType } from "@athena/core/sources";

export const TYPE_LABEL: Record<SourceType, { short: string; label: string; cls: string }> = {
  owned: { short: "O", label: "Owned", cls: "bg-brand-50 text-brand-700" },
  competitor: { short: "C", label: "Competitor", cls: "bg-orange-50 text-orange-700" },
  partner: { short: "P", label: "Partner", cls: "bg-emerald-50 text-emerald-700" },
  third_party: { short: "T", label: "Third-party", cls: "bg-gray-100 text-gray-600" },
};

export function TypeBadge({ type }: { type: SourceType }) {
  const t = TYPE_LABEL[type];
  return (
    <span className={`badge ${t.cls}`} title={t.label}>
      {t.short} · {t.label}
    </span>
  );
}

export function rangeWindow(range?: string): { from: Date; to: Date; range: string } {
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "90d" ? 90 : 30;
  const to = new Date();
  return { from: new Date(to.getTime() - days * 86_400_000), to, range: `${days}d` };
}
