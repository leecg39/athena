import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, competitors } from "@athena/db";
import { MODEL_LABELS } from "@athena/core";
import { getResponseDetail } from "@athena/core/analytics";
import { aliasesFor, highlightSegments } from "@athena/core/extract";
import { NotFoundError } from "@athena/core/org";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Response" };

const LABELS: Record<string, string> = { ...MODEL_LABELS, simulated: "Simulated (dev)" };

/** Only http(s) links are rendered as anchors. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export default async function ResponseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  const { id } = await params;
  let d;
  try {
    d = await getResponseDetail(db, { actorId: ws.user.id, websiteId: ws.websiteId, responseId: id });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const comps = await db.select().from(competitors).where(and(eq(competitors.websiteId, ws.websiteId), isNull(competitors.deletedAt)));
  const segments = highlightSegments(d.rawText, [
    { key: "brand", aliases: aliasesFor(ws.website.name, ws.website.domain) },
    ...comps.map((c) => ({ key: c.id, aliases: aliasesFor(c.name, c.domain) })),
  ]);
  const compName = new Map(comps.map((c) => [c.id, c.name]));

  return (
    <div>
      <PageHeader title="AI answer" subtitle={d.promptText} actions={<Link href="/responses" className="btn-secondary text-xs">← All responses</Link>} />
      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <article className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="badge bg-gray-100 text-gray-700">{LABELS[d.model] ?? d.model}</span>
            {d.provider ? <span>{d.provider}</span> : null}
            <span>{d.ranAt.toISOString().replace("T", " ").slice(0, 16)} UTC</span>
            {d.topicName ? <span>· {d.topicName}</span> : null}
            {d.simulated ? <span className="badge bg-amber-50 text-amber-700">simulated — not real AI output</span> : null}
          </div>
          <div className="whitespace-pre-wrap rounded-xl border border-gray-100 bg-white p-5 text-sm leading-relaxed text-gray-800">
            {segments.map((s, i) =>
              s.entity ? (
                <mark key={i} className={s.entity === "brand" ? "rounded bg-brand-100 px-0.5 text-brand-700" : "rounded bg-amber-100 px-0.5 text-amber-900"}>
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            <mark className="rounded bg-brand-100 px-0.5 text-brand-700">{ws.website.name}</mark> your brand ·{" "}
            <mark className="rounded bg-amber-100 px-0.5 text-amber-900">competitor</mark>
          </p>
        </article>
        <aside className="space-y-4">
          <section className="metric-card">
            <h2 className="text-sm font-semibold text-gray-900">Visibility</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <dt className="text-gray-500">Mentioned</dt>
              <dd>{d.mentioned ? `yes · #${d.position ?? "?"}` : "no"}</dd>
              <dt className="text-gray-500">Sentiment</dt>
              <dd>{d.mentioned ? d.sentiment : "—"}</dd>
              <dt className="text-gray-500">Your site cited</dt>
              <dd>{d.cited ? "yes" : "no"}</dd>
              <dt className="text-gray-500">Tokens</dt>
              <dd>
                {d.tokensIn ?? 0} in / {d.tokensOut ?? 0} out
              </dd>
            </dl>
          </section>
          <section className="metric-card">
            <h2 className="text-sm font-semibold text-gray-900">Brands mentioned</h2>
            {d.mentions.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">No tracked brands mentioned.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {d.mentions.map((m, i) => (
                  <li key={i} className="flex justify-between">
                    <span className={m.competitorId ? "text-gray-700" : "font-semibold text-brand-700"}>{m.competitorId ? compName.get(m.competitorId) ?? m.name : m.name}</span>
                    <span className="text-gray-400">
                      #{m.position ?? "?"} · {m.sentiment}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="metric-card">
            <h2 className="text-sm font-semibold text-gray-900">Sources ({d.citations.length})</h2>
            <ol className="mt-2 space-y-1 text-xs">
              {d.citations.map((c) => {
                const href = safeHref(c.url);
                return (
                  <li key={c.url} className="truncate">
                    <span className="text-gray-400">{c.rank + 1}.</span>{" "}
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={c.isBrand ? "font-medium text-brand-600" : "text-gray-700 hover:underline"}>
                        {c.domain}
                      </a>
                    ) : (
                      <span>{c.domain}</span>
                    )}
                    {c.isBrand ? <span className="ml-1 badge bg-brand-50 text-brand-600">your site</span> : null}
                  </li>
                );
              })}
            </ol>
          </section>
          {d.observations.length ? (
            <section className="metric-card">
              <h2 className="text-sm font-semibold text-gray-900">Attribute observations</h2>
              <ul className="mt-2 space-y-2 text-xs">
                {d.observations.map((o, i) => (
                  <li key={i}>
                    <span className={o.positive ? "text-emerald-700" : "text-red-700"}>{o.positive ? "+" : "−"} {o.attribute}</span>{" "}
                    <span className="text-gray-400">({o.competitorId ? compName.get(o.competitorId) ?? "competitor" : ws.website.name})</span>
                    <p className="text-gray-500">“{o.textSpan}”</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
