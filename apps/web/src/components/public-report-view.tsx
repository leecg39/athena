import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { db } from "@athena/db";
import { getPublicReportByShareId, type PublicReportData } from "@athena/core/reports";
import { isPitchShareId } from "@athena/core/pitches";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { renderPublicPitchView, PublicHeader, Kpis, ShareBars } from "@/components/public-pitch-view";

type Tt = Awaited<ReturnType<typeof getTranslations>>;

function Notices({ report, tt }: { report: PublicReportData; tt: Tt }) {
  return (
    <>
      {report.kpis.responses === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">{tt("No AI answers were collected for this website in this period.")}</div>
      ) : null}
      {report.kpis.simulatedSharePct > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {tt("{0}% of these answers come from the development simulator, not from real AI models.", { 0: report.kpis.simulatedSharePct })}
        </div>
      ) : null}
    </>
  );
}

function Trends({ report, tt }: { report: PublicReportData; tt: Tt }) {
  const charts = new Set(report.charts);
  if (!report.daily.length || !(charts.has("mention_rate") || charts.has("citation_rate"))) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {charts.has("mention_rate") ? (
        <MetricCard title={tt("Mention Rate")} subtitle={tt("% of collected answers mentioning the brand, by day")} value={report.kpis.mentionRatePct === null ? "—" : `${report.kpis.mentionRatePct}%`} data={report.daily.map((d) => ({ date: d.date, brand: d.mentionRatePct }))} detailed={false} />
      ) : null}
      {charts.has("citation_rate") ? (
        <MetricCard title={tt("Citation Rate")} subtitle={tt("% of collected answers citing the brand's domain, by day")} value={report.kpis.citationRatePct === null ? "—" : `${report.kpis.citationRatePct}%`} data={report.daily.map((d) => ({ date: d.date, brand: d.citationRatePct }))} detailed={false} />
      ) : null}
    </div>
  );
}

function Opportunities({ report, tt, isContent }: { report: PublicReportData; tt: Tt; isContent: boolean }) {
  const charts = new Set(report.charts);
  const showGaps = charts.has("prompt_gaps") || isContent;
  const showPipeline = charts.has("content_proposals") || isContent;
  if (!showGaps && !showPipeline) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {showGaps ? (
        <div className="metric-card">
          <div className="mb-1 text-sm font-semibold text-gray-900">{tt("Prompt gaps")}</div>
          <div className="mb-3 text-xs text-gray-500">{tt("Tracked prompts whose answers mention the brand in half of the answers or fewer")}</div>
          {report.promptGaps.length ? (
            <div className="space-y-2">
              {report.promptGaps.map((g) => (
                <div key={g.prompt} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-xs">
                  <div className="font-semibold text-gray-900">&ldquo;{g.prompt}&rdquo;</div>
                  <div className="mt-1 text-gray-600">
                    {tt("Mentioned in {0}% of {1} answers", { 0: g.mentionRatePct, 1: g.answers })}
                    {g.volume ? ` · ${tt("{0} searches/mo", { 0: g.volume.toLocaleString() })}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-500">{tt(report.kpis.responses ? "No gaps in this period." : "Not enough answers to find gaps.")}</div>
          )}
        </div>
      ) : null}
      {showPipeline ? (
        <div className="metric-card">
          <div className="mb-3 text-sm font-semibold text-gray-900">{tt("Content pipeline")}</div>
          {report.contentProposals.length ? (
            <div className="space-y-2">
              {report.contentProposals.map((p) => (
                <div key={p.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-900">{p.title}</span>
                    <span className="badge bg-brand-50 text-[10px] text-brand-700">{tt(p.status)}</span>
                  </div>
                  {p.targetUrl ? <div className="mt-1 font-mono text-[11px] text-brand-600">{p.targetUrl}</div> : null}
                  {p.summary ? <div className="mt-1 text-gray-600">{p.summary}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-500">{tt("No content items yet.")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Extras({ report, tt }: { report: PublicReportData; tt: Tt }) {
  const charts = new Set(report.charts);
  const value = report.searchValue;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {charts.has("ai_search_value") ? (
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">{tt("AI-visible searches")}</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{value.hasVolume ? value.aiVisibleSearches.toLocaleString() : "—"}</div>
          <div className="mt-1 text-xs text-gray-500">
            {value.hasVolume ? tt("of {0} tracked monthly searches, weighted by how often answers mention the brand", { 0: value.trackedVolume.toLocaleString() }) : tt("No search volume data for the tracked prompts (connect Search Console).")}
          </div>
        </div>
      ) : null}
      {charts.has("site_health_summary") ? (
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">{tt("AI crawler access")}</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{report.crawler.aiAccessiblePct === null ? "—" : `${report.crawler.aiAccessiblePct}%`}</div>
          <div className="mt-1 text-xs text-gray-500">
            {report.crawler.pagesChecked ? tt("of {0} crawled pages allow AI crawlers", { 0: report.crawler.pagesChecked }) : tt("Not checked yet — run a Site Health crawl.")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export async function renderPublicReportView(shareId: string, forceContentMode = false) {
  if (isPitchShareId(shareId)) return renderPublicPitchView(shareId);
  const tt = await getTranslations();
  let report: PublicReportData;
  try {
    report = await getPublicReportByShareId(db, shareId);
  } catch {
    notFound();
  }
  const isContent = forceContentMode || report.reportType === "content_proposal";
  const charts = new Set(report.charts);
  const k = report.kpis;
  return (
    <div className="min-h-screen bg-gray-50">
      <PublicHeader brand={report.brandName} domain={report.brandDomain} badge={tt(isContent ? "Content Proposal Report" : "AI Search Visibility Report")} pdfHref={`/api/reports/${report.id}/pdf?shareId=${encodeURIComponent(report.shareId)}`} tt={tt} />
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <PageHeader title={report.name} subtitle={tt("Read-only report for {0} ({1}) · last {2} days · {3} AI answers collected", { 0: report.brandName, 1: report.brandDomain, 2: report.period.days, 3: k.responses })} />
        <Notices report={report} tt={tt} />
        <Kpis tt={tt} mention={k.mentionRatePct} citation={k.citationRatePct} sov={k.shareOfVoicePct} position={k.avgPosition} answers={k.responses} />
        <Trends report={report} tt={tt} />
        {charts.has("share_of_voice") && report.competitorSov.length ? <ShareBars rows={report.competitorSov} tt={tt} /> : null}
        {charts.has("top_sources") && report.topSources.length ? (
          <div className="metric-card">
            <div className="mb-3 text-sm font-semibold text-gray-900">{tt("Top cited domains")}</div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {report.topSources.map((s) => (
                <div key={s.domain} className={`flex items-center justify-between rounded-lg border p-3 ${s.isOwn ? "border-brand-200 bg-brand-50/40" : "border-gray-100 bg-gray-50/60"}`}>
                  <span className="font-mono text-xs font-semibold text-gray-900">{s.domain}</span>
                  <span className="badge bg-white font-mono text-xs text-gray-800">{tt("{0} citations", { 0: s.citations })}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <Extras report={report} tt={tt} />
        <Opportunities report={report} tt={tt} isContent={isContent} />
        <div className="rounded-xl bg-brand-50 p-6 text-center">
          <div className="text-sm font-medium text-brand-700">{tt("Track how AI assistants describe your brand")}</div>
          <a href="/signup" className="btn-primary mt-3 inline-flex">{tt("Start tracking")}</a>
        </div>
      </div>
    </div>
  );
}
