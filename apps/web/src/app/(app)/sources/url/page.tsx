import Link from "next/link";
import { db } from "@athena/db";
import { MODEL_LABELS } from "@athena/core";
import { urlInspector } from "@athena/core/sources";
import { DomainError } from "@athena/core/org";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/lib/workspace";
import { TypeBadge, rangeWindow } from "../_components/shared";

export const metadata = { title: "URL inspector" };
const LABELS: Record<string, string> = { ...MODEL_LABELS, simulated: "Simulated (dev)" };

export default async function UrlInspectorPage({ searchParams }: { searchParams: Promise<{ u?: string; range?: string }> }) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const { from, to } = rangeWindow(sp.range);
  let result;
  let error: string | null = null;
  try {
    result = await urlInspector(db, { actorId: ws.user.id, websiteId: ws.websiteId, url: (sp.u ?? "").slice(0, 2000), filters: { from, to } });
  } catch (err) {
    if (err instanceof DomainError) error = err.message;
    else throw err;
  }
  return (
    <div>
      <PageHeader title="URL inspector" subtitle={result?.normalizedUrl ?? "How a single cited page performs across AI models"} actions={<Link href="/sources" className="btn-secondary text-xs">← All sources</Link>} />
      <div className="space-y-4 p-6">
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {result ? (
          result.totalResponses === 0 ? (
            <p className="text-sm text-gray-400">This URL was not cited in the last period.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="metric-card">
                <div className="text-xs text-gray-500">Answers citing this page</div>
                <div className="mt-1 text-2xl font-semibold">{result.totalResponses}</div>
                <div className="mt-2">
                  <TypeBadge type={result.type} />
                </div>
              </section>
              <section className="metric-card">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">By AI model</h2>
                <ul className="space-y-1 text-xs">
                  {result.byModel.map((m) => (
                    <li key={m.model} className="flex justify-between">
                      <span>{LABELS[m.model] ?? m.model}</span>
                      <span className="text-gray-400">{m.responses}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="metric-card">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">URL variants seen</h2>
                <ul className="space-y-1 break-all text-xs text-gray-600">
                  {result.variants.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </section>
              <section className="metric-card lg:col-span-3">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">Answers</h2>
                <ul className="space-y-1 text-xs">
                  {result.responses.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3">
                      <Link href={`/responses/${r.id}`} className="truncate text-gray-700 hover:text-brand-600 hover:underline">
                        {r.promptText}
                      </Link>
                      <span className="shrink-0 text-gray-400">
                        {LABELS[r.model] ?? r.model} · {r.ranAt.toISOString().slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
