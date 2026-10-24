import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { db } from "@athena/db";
import { getPublicPitchByShareId, type PublicPitch } from "@athena/core/pitches";
import { PageHeader } from "@/components/page-header";

type Tt = Awaited<ReturnType<typeof getTranslations>>;
const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

export function PublicHeader(props: { brand: string; domain: string; badge: string; pdfHref?: string; tt: Tt }) {
  return (
    <header className="border-b border-gray-100 bg-white px-6 py-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <div>
          <span className="font-semibold text-gray-900">{props.tt("Athenum")}</span>
          <span className="ml-2 text-xs text-gray-400">{props.brand} ({props.domain})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-brand-50 text-brand-700">{props.badge}</span>
          {props.pdfHref ? <a href={props.pdfHref} className="btn-secondary !px-3 !py-1.5 text-xs">{props.tt("⬇ Download PDF")}</a> : null}
        </div>
      </div>
    </header>
  );
}

export function Kpis(props: { tt: Tt; mention: number | null; citation: number | null; sov: number | null; position: number | null; answers: number }) {
  const { tt } = props;
  const cards = [
    { label: tt("Brand Mention Rate"), value: pctText(props.mention), note: tt("of {0} AI answers", { 0: props.answers }) },
    { label: tt("Citation Rate"), value: pctText(props.citation), note: tt("answers citing the brand's domain") },
    { label: tt("Share of Voice (SOV)"), value: pctText(props.sov), note: tt("of mentions among the tracked brands") },
    { label: tt("Avg. position"), value: props.position === null ? "—" : `#${props.position}`, note: tt("when the brand is mentioned") },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="metric-card">
          <div className="text-xs text-gray-400">{c.label}</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{c.value}</div>
          <div className="mt-1 text-xs text-gray-500">{c.note}</div>
        </div>
      ))}
    </div>
  );
}

export function ShareBars(props: { rows: { name: string; isOwn: boolean; mentions: number; sovPct: number }[]; tt: Tt }) {
  return (
    <div className="metric-card">
      <div className="mb-3 text-sm font-semibold text-gray-900">{props.tt("Share of Voice vs. Competitors")}</div>
      <div className="space-y-2.5">
        {props.rows.map((c) => (
          <div key={c.name} className="flex items-center gap-3">
            <span className={`w-40 truncate text-xs ${c.isOwn ? "font-semibold text-brand-700" : "text-gray-600"}`}>{c.name}</span>
            <div className="h-2.5 flex-1 rounded-full bg-gray-100">
              <div className={`h-2.5 rounded-full ${c.isOwn ? "bg-brand-600" : "bg-gray-300"}`} style={{ width: `${Math.min(100, Math.max(2, c.sovPct))}%` }} />
            </div>
            <span className="w-24 text-right font-mono text-xs text-gray-800">{c.sovPct}% · {c.mentions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Answers({ pitch, tt }: { pitch: PublicPitch; tt: Tt }) {
  const p = pitch.payload;
  return (
    <div className="metric-card overflow-x-auto">
      <div className="mb-3 text-sm font-semibold text-gray-900">{tt("Collected answers")}</div>
      <table className="table-base text-xs">
        <thead>
          <tr>
            <th>{tt("Question")}</th>
            <th>{tt("Model")}</th>
            <th>{tt("Mentioned")}</th>
            <th>{tt("Position")}</th>
            <th>{tt("Cited")}</th>
            <th>{tt("Answer excerpt")}</th>
          </tr>
        </thead>
        <tbody>
          {p.answers.map((a, i) => (
            <tr key={`${a.prompt}-${a.model}-${i}`}>
              <td className="max-w-[180px]">{a.prompt}</td>
              <td>{a.model}{a.simulated ? ` (${tt("simulated")})` : ""}</td>
              <td>{a.mentioned ? "✓" : "—"}</td>
              <td>{a.position ? `#${a.position}` : "—"}</td>
              <td>{a.cited ? "✓" : "—"}</td>
              <td className="max-w-[320px] text-gray-600">{a.excerpt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.failures.length ? <div className="mt-2 text-xs text-gray-500">{tt("{0} answers could not be collected (provider errors).", { 0: p.failures.length })}</div> : null}
    </div>
  );
}

function Rewrite({ pitch, tt }: { pitch: PublicPitch; tt: Tt }) {
  const r = pitch.payload.rewrite;
  if (!r) return null;
  const jsonLd = r.faq.length ? JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: r.faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }, null, 2) : null;
  return (
    <div className="metric-card space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-900">{tt("Content rewrite — before and after")}</div>
        <div className="text-xs text-gray-500">
          {tt("Written by {0} from the page copy only; facts in brackets need to be filled in.", { 0: r.writtenBy })}
          {r.targetPageUrl ? <span className="ml-1 font-mono text-brand-600">{r.targetPageUrl}</span> : null}
          {r.focusPrompt ? <span className="ml-1">· {tt("Focus question:")} &ldquo;{r.focusPrompt}&rdquo;</span> : null}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3.5">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{tt("Before")}</div>
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{r.beforeCopy}</div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3.5">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">{tt("After")}</div>
          <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800">{r.afterCopy}</div>
        </div>
      </div>
      {jsonLd ? (
        <div className="rounded-lg bg-gray-900 p-3.5">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-300">{tt("FAQPage JSON-LD for the rewritten FAQ")}</div>
          <pre className="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-300">{jsonLd}</pre>
        </div>
      ) : null}
    </div>
  );
}

export async function renderPublicPitchView(shareId: string) {
  const tt = await getTranslations();
  let pitch: PublicPitch;
  try {
    pitch = await getPublicPitchByShareId(db, shareId);
  } catch {
    notFound();
  }
  const p = pitch.payload;
  const t = p.totals;
  return (
    <div className="min-h-screen bg-gray-50">
      <PublicHeader brand={pitch.brandName} domain={pitch.domain} badge={tt("AI search audit")} tt={tt} />
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <PageHeader
          title={tt("How {0} shows up in AI answers", { 0: pitch.brandName })}
          subtitle={tt("Measured from {0} AI answers collected on {1} for {2} buyer questions ({3})", { 0: t.answers, 1: p.collectedAt.slice(0, 10), 2: p.prompts.length, 3: p.models.join(", ") })}
        />
        {t.simulatedSharePct > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{tt("{0}% of these answers come from the development simulator, not from real AI models.", { 0: t.simulatedSharePct })}</div>
        ) : null}
        <Kpis tt={tt} mention={t.mentionRatePct} citation={t.citationRatePct} sov={t.shareOfVoicePct} position={t.avgPosition} answers={t.answers} />
        {p.competitorSov.length ? <ShareBars rows={p.competitorSov} tt={tt} /> : null}
        {p.topSources.length ? (
          <div className="metric-card">
            <div className="mb-3 text-sm font-semibold text-gray-900">{tt("Top cited domains")}</div>
            <div className="flex flex-wrap gap-2">
              {p.topSources.map((s) => (
                <span key={s.domain} className={`badge font-mono ${s.isOwn ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-700"}`}>{s.domain} · {s.citations}</span>
              ))}
            </div>
          </div>
        ) : null}
        <Answers pitch={pitch} tt={tt} />
        <Rewrite pitch={pitch} tt={tt} />
        <div className="rounded-xl bg-brand-50 p-6 text-center">
          <div className="text-sm font-medium text-brand-700">{tt("Track how AI assistants describe your brand")}</div>
          <a href="/signup" className="btn-primary mt-3 inline-flex">{tt("Start tracking")}</a>
        </div>
      </div>
    </div>
  );
}
