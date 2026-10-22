import Link from "next/link";
import { db } from "@athena/db";
import { MODEL_LABELS } from "@athena/core";
import { sourceDetail } from "@athena/core/sources";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/lib/workspace";
import { Sparkline } from "../_components/sparkline";
import { TypeBadge, rangeWindow } from "../_components/shared";

export const metadata = { title: "Source domain" };
const LABELS: Record<string, string> = { ...MODEL_LABELS, simulated: "Simulated (dev)" };

export default async function SourceDomainPage({ params, searchParams }: { params: Promise<{ domain: string }>; searchParams: Promise<{ range?: string }> }) {
  const ws = await requireWorkspace();
  const { domain } = await params;
  const { from, to } = rangeWindow((await searchParams).range);
  // params arrive decoded already; decoding again would throw on a literal "%"
  const d = await sourceDetail(db, { actorId: ws.user.id, websiteId: ws.websiteId, rootDomain: domain.slice(0, 253), filters: { from, to } });
  const cited = d.trend.reduce((s, t) => s + t.responses, 0);
  return (
    <div>
      <PageHeader title={d.rootDomain} subtitle={`Cited in ${cited} of ${d.totalResponses} AI answers in the period`} actions={<Link href="/sources" className="btn-secondary text-xs">← All sources</Link>} />
      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="metric-card">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Citation trend (% of answers per day)</h2>
              <TypeBadge type={d.type} />
            </div>
            <div className="mt-3">
              <Sparkline values={d.trend.map((t) => t.citationPct)} width={560} height={64} />
            </div>
          </section>
          <section className="metric-card">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Cited pages</h2>
            <ul className="space-y-1 text-xs">
              {d.pages.map((p) => (
                <li key={p.url} className="flex items-center justify-between gap-3">
                  <Link href={`/sources/url?u=${encodeURIComponent(p.url)}`} className="truncate text-gray-700 hover:text-brand-600 hover:underline">
                    {p.url}
                  </Link>
                  <span className="shrink-0 text-gray-400">{p.responses} answers</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="metric-card">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Answers citing {d.rootDomain}</h2>
            <ul className="space-y-1 text-xs">
              {d.responses.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <Link href={`/responses/${r.id}`} className="truncate text-gray-700 hover:text-brand-600 hover:underline">
                    {r.promptText}
                  </Link>
                  <span className="shrink-0 text-gray-400">
                    {LABELS[r.model] ?? r.model} · {r.ranAt.toISOString().slice(0, 10)} · {r.mentioned ? "brand mentioned" : "no brand"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="metric-card">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Prompts that cite it</h2>
            <ul className="space-y-1 text-xs">
              {d.prompts.map((p) => (
                <li key={p.promptId} className="flex justify-between gap-2">
                  <span className="text-gray-700">{p.text}</span>
                  <span className="text-gray-400">{p.responses}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="metric-card">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Competitors mentioned alongside</h2>
            {d.competitors.length ? (
              <ul className="space-y-1 text-xs">
                {d.competitors.map((c) => (
                  <li key={c.competitorId} className="flex justify-between">
                    <span>{c.name}</span>
                    <span className="text-gray-400">{c.responses} answers</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">None.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
