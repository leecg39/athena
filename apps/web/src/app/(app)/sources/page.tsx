import Link from "next/link";
import { db } from "@athena/db";
import { MODEL_LABELS } from "@athena/core";
import { listSources, sourceSankey, listSourceOverrides, SOURCE_TYPES, type SourceType } from "@athena/core/sources";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { requireWorkspace } from "@/lib/workspace";
import { Sparkline } from "./_components/sparkline";
import { SourceSankey } from "./_components/sankey";
import { TypeBadge, TYPE_LABEL, rangeWindow } from "./_components/shared";
import { setSourceTypeAction, removeSourceTypeAction } from "./actions";

export const metadata = { title: "Sources" };

const PAGE = 50;
const TABS = [
  ["domains", "Cited domains"],
  ["visualization", "Visualization"],
  ["types", "Source types"],
] as const;

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const tab = TABS.some(([id]) => id === sp.tab) ? sp.tab! : "domains";
  const { from, to, range } = rangeWindow(sp.range);
  const model = sp.model && /^[a-z_]{2,20}$/.test(sp.model) ? sp.model : undefined;
  const type = SOURCE_TYPES.includes(sp.type as SourceType) ? (sp.type as SourceType) : undefined;
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const c = { actorId: ws.user.id, websiteId: ws.websiteId };
  const filters = { from, to, models: model ? [model] : undefined };
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, range, model, type, q, ...patch })) if (v) p.set(k, v);
    return `/sources?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Sources" subtitle="Which websites AI answers cite for your tracked prompts" />
      <nav className="flex gap-1 border-b border-gray-100 px-6" aria-label="Source sections">
        {TABS.map(([id, label]) => (
          <Link key={id} href={qs({ tab: id, page: undefined })} aria-current={tab === id ? "page" : undefined} className={`border-b-2 px-3 py-2.5 text-sm ${tab === id ? "border-brand-600 font-medium text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <form action="/sources" className="flex flex-wrap items-center gap-2 text-xs">
            <input type="hidden" name="tab" value={tab} />
            <select name="range" defaultValue={range} aria-label="Date range" className="input !w-auto !py-1.5 text-xs">
              <option value="7d">Last 7 days</option>
              <option value="14d">Last 14 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
            <select name="model" defaultValue={model ?? ""} aria-label="AI model" className="input !w-auto !py-1.5 text-xs">
              <option value="">All models</option>
              {[...Object.entries(MODEL_LABELS), ["simulated", "Simulated (dev)"]].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {tab === "domains" ? (
              <>
                <select name="type" defaultValue={type ?? ""} aria-label="Source type" className="input !w-auto !py-1.5 text-xs">
                  <option value="">All types</option>
                  {SOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t].label}
                    </option>
                  ))}
                </select>
                <input name="q" defaultValue={q ?? ""} placeholder="Filter domains" className="input !w-40 !py-1.5 text-xs" />
              </>
            ) : null}
            <button type="submit" className="btn-secondary !py-1.5 text-xs">
              Apply
            </button>
          </form>
          <form action="/sources/url" className="ml-auto flex items-center gap-2 text-xs">
            <input name="u" type="url" required placeholder="Inspect a cited URL…" className="input !w-64 !py-1.5 text-xs" aria-label="URL to inspect" />
            <button type="submit" className="btn-secondary !py-1.5 text-xs">
              Inspect
            </button>
          </form>
        </div>

        {tab === "domains" ? <DomainsTab c={c} filters={filters} type={type} q={q} page={page} qs={qs} /> : null}
        {tab === "visualization" ? <SourceSankey data={await sourceSankey(db, { ...c, filters, limit: 12 })} /> : null}
        {tab === "types" ? <TypesTab c={c} /> : null}
      </div>
    </div>
  );
}

async function DomainsTab({
  c,
  filters,
  type,
  q,
  page,
  qs,
}: {
  c: { actorId: string; websiteId: string };
  filters: { from: Date; to: Date; models?: string[] };
  type?: SourceType;
  q?: string;
  page: number;
  qs: (patch: Record<string, string | undefined>) => string;
}) {
  const r = await listSources(db, { ...c, filters, type, q, limit: PAGE, offset: (page - 1) * PAGE });
  if (!r.rows.length) return <p className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">No cited sources in this period.</p>;
  const pages = Math.max(1, Math.ceil(r.total / PAGE));
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="table-base">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Type</th>
              <th title="Share of all answers in the period that cite this domain">Citation %</th>
              <th>Trend</th>
              <th title="Of the answers citing this domain, share that mention your brand">Brand mention %</th>
              <th title="Of the answers citing this domain, share that mention a tracked competitor">Competitor mention %</th>
              <th>Answers</th>
              <th>First seen</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((s) => (
              <tr key={s.rootDomain}>
                <td>
                  <Link href={`/sources/${encodeURIComponent(s.rootDomain)}`} className="font-medium text-gray-900 hover:text-brand-600 hover:underline">
                    {s.rootDomain}
                  </Link>
                </td>
                <td>
                  <TypeBadge type={s.type} />
                </td>
                <td>{s.citationPct}%</td>
                <td>
                  <Sparkline values={s.spark} />
                </td>
                <td>{s.brandMentionPct}%</td>
                <td>{s.competitorMentionPct}%</td>
                <td className="text-gray-500">{s.responses}</td>
                <td className="text-xs text-gray-400">{s.firstSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>
          {r.total} domains · {r.totalResponses} answers
        </span>
        {page > 1 ? <Link href={qs({ page: String(page - 1) })}>← Previous</Link> : null}
        {pages > 1 ? (
          <span>
            Page {page} of {pages}
          </span>
        ) : null}
        {page < pages ? <Link href={qs({ page: String(page + 1) })}>Next →</Link> : null}
      </div>
    </>
  );
}

async function TypesTab({ c }: { c: { actorId: string; websiteId: string } }) {
  const overrides = await listSourceOverrides(db, c);
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Your own site and its subdomains are Owned and tracked competitors are Competitor automatically. Mark other domains or URL prefixes (e.g.{" "}
        <code>reddit.com/user/yourbrand</code>) as Owned, Partner or Third-party here.
      </p>
      <ActionForm action={setSourceTypeAction} submitLabel="Save type" className="flex flex-wrap items-center gap-2" resetOnSuccess>
        <input name="pattern" required placeholder="example.com or example.com/path" className="input !w-72" aria-label="Domain or URL prefix" />
        <select name="type" defaultValue="partner" className="input !w-auto" aria-label="Type">
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t].label}
            </option>
          ))}
        </select>
      </ActionForm>
      {overrides.length === 0 ? (
        <p className="text-sm text-gray-400">No overrides yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
          {overrides.map((o) => (
            <li key={o.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                <code>{o.pattern}</code> <TypeBadge type={o.type as SourceType} />
              </span>
              <ActionForm action={removeSourceTypeAction} submitLabel="Remove" variant="secondary">
                <input type="hidden" name="pattern" value={o.pattern} />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
