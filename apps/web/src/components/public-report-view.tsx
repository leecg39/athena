import { notFound } from "next/navigation";
import { db } from "@athena/db";
import {
  getPublicReportByShareId,
  type PublicReportData,
} from "@athena/core/reports";
import { demoCitationSeries, demoMentionSeries, demoCompetitorSoV } from "@/lib/demo";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";

function buildDemoFallback(shareId: string): PublicReportData {
  const brand = shareId.replace(/^demo-/, "") || "Canvasly";
  const mention = demoMentionSeries(14);
  const citation = demoCitationSeries(14);
  const sov = demoCompetitorSoV();
  return {
    id: "demo",
    shareId,
    name: `How ${brand} shows up in AI search`,
    reportType: "ai_search",
    brandName: brand,
    brandDomain: `${brand.toLowerCase()}.io`,
    cadence: "weekly",
    charts: ["mention_rate", "citation_rate", "share_of_voice", "top_sources"],
    generatedAt: new Date().toISOString(),
    kpis: {
      mentionRatePct: +(mention.reduce((a, b) => a + b.brand, 0) / mention.length).toFixed(1),
      citationRatePct: +(citation.reduce((a, b) => a + b.brand, 0) / citation.length).toFixed(1),
      shareOfVoicePct: sov[0]?.sov ?? 38.4,
      estimatedMonthlyValueUsd: 18400,
      totalResponsesAnalyzed: 240,
      activePromptsCount: 28,
      aiAccessiblePct: 96.4,
    },
    mentionSeries: mention,
    citationSeries: citation,
    competitorSov: sov.map((c, idx) => ({
      name: idx === 0 ? brand : c.name,
      isOwn: idx === 0,
      mentions: Math.round(c.sov * 3),
      sovPct: c.sov,
    })),
    topSources: [
      { domain: `${brand.toLowerCase()}.io`, citations: 32, isOwn: true },
      { domain: "g2.com", citations: 45, isOwn: false },
      { domain: "techcrunch.com", citations: 39, isOwn: false },
    ],
    promptGaps: [
      {
        prompt: "best ai design tools for enterprise product teams",
        volume: 3800,
        recommendation: `Publish an enterprise benchmark page on ${brand.toLowerCase()}.io with FAQPage schema.`,
      },
    ],
    contentProposals: [
      {
        id: "demo-c1",
        title: `${brand} Enterprise AI Workflow Guide 2026`,
        status: "draft",
        targetUrl: `https://${brand.toLowerCase()}.io/blog/enterprise-ai-guide`,
        summary: "Structured comparison and pricing guide targeting high-intent AI search queries.",
      },
    ],
  };
}

export async function renderPublicReportView(shareId: string, forceContentMode = false) {
  let report: PublicReportData;
  if (shareId.startsWith("demo-")) {
    report = buildDemoFallback(shareId);
  } else {
    try {
      report = await getPublicReportByShareId(db, shareId);
    } catch {
      notFound();
    }
  }

  const isContentReport = forceContentMode || report.reportType === "content_proposal";
  const charts = new Set(report.charts);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              🏛
            </div>
            <div>
              <span className="font-semibold text-gray-900">Athenum</span>
              <span className="ml-2 text-xs text-gray-400">
                {report.brandName} ({report.brandDomain})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`badge ${
                isContentReport ? "bg-purple-50 text-purple-700" : "bg-brand-50 text-brand-700"
              }`}
            >
              {isContentReport ? "Content Proposal Report" : "AI Search Visibility Report"}
            </span>
            {report.id !== "demo" ? (
              <a
                href={`/api/reports/${report.id}/pdf?shareId=${encodeURIComponent(report.shareId)}`}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                ⬇ Download PDF
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <PageHeader
          title={report.name}
          subtitle={`Live read-only ${
            isContentReport ? "content proposal & prompt opportunity deck" : "AI search visibility report"
          } for ${report.brandName} (${report.brandDomain}) · Cadence: ${report.cadence}`}
        />

        {/* Executive KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs text-gray-400">Brand Mention Rate</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {report.kpis.mentionRatePct.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Across {report.kpis.totalResponsesAnalyzed} AI responses
            </div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-400">Citation Authority Rate</div>
            <div className="mt-1 text-2xl font-bold text-brand-700">
              {report.kpis.citationRatePct.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Primary source citations on {report.brandDomain}
            </div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-400">Share of Voice (SOV)</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {report.kpis.shareOfVoicePct.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {report.kpis.activePromptsCount} tracked category prompts
            </div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-400">Est. Monthly AI Search Value</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">
              ${report.kpis.estimatedMonthlyValueUsd.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              AI Crawler Health {report.kpis.aiAccessiblePct.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Mention & Citation Trend Charts */}
        {(charts.has("mention_rate") || charts.has("citation_rate")) &&
        report.mentionSeries.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {charts.has("mention_rate") ? (
              <MetricCard
                title="Mention Rate"
                subtitle="% of AI responses mentioning the brand"
                value={`${report.kpis.mentionRatePct.toFixed(1)}%`}
                data={report.mentionSeries}
              />
            ) : null}
            {charts.has("citation_rate") ? (
              <MetricCard
                title="Citation Rate"
                subtitle="% of AI responses citing the brand"
                value={`${report.kpis.citationRatePct.toFixed(1)}%`}
                data={report.citationSeries}
              />
            ) : null}
          </div>
        ) : null}

        {/* Share of Voice vs Competitors */}
        {charts.has("share_of_voice") && report.competitorSov.length > 0 ? (
          <div className="metric-card">
            <div className="mb-3 text-sm font-semibold text-gray-900">
              Share of Voice vs. Competitors
            </div>
            <div className="space-y-2.5">
              {report.competitorSov.map((c) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span
                    className={`w-40 truncate text-xs ${
                      c.isOwn ? "font-semibold text-brand-700" : "text-gray-600"
                    }`}
                  >
                    {c.isOwn ? `${c.name} (Own Brand)` : c.name}
                  </span>
                  <div className="h-2.5 flex-1 rounded-full bg-gray-100">
                    <div
                      className={`h-2.5 rounded-full ${c.isOwn ? "bg-brand-600" : "bg-gray-300"}`}
                      style={{ width: `${Math.min(100, Math.max(4, c.sovPct))}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-xs font-medium text-gray-800">
                    {c.sovPct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Top Cited Sources */}
        {charts.has("top_sources") && report.topSources.length > 0 ? (
          <div className="metric-card">
            <div className="mb-3 text-sm font-semibold text-gray-900">
              Top Cited Domains Across AI Answers
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {report.topSources.map((s) => (
                <div
                  key={s.domain}
                  className={`flex items-center justify-between rounded-lg border p-3 ${
                    s.isOwn ? "border-brand-200 bg-brand-50/40" : "border-gray-100 bg-gray-50/60"
                  }`}
                >
                  <div>
                    <div className="font-mono text-xs font-semibold text-gray-900">{s.domain}</div>
                    <div className="text-[11px] text-gray-500">
                      {s.isOwn ? "Own Brand Domain" : "Third-Party Authority"}
                    </div>
                  </div>
                  <span className="badge bg-white font-mono text-xs text-gray-800">
                    {s.citations} citations
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Content Proposals & Prompt Gaps */}
        {(isContentReport || charts.has("content_proposals") || charts.has("prompt_gaps")) ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="metric-card">
              <div className="mb-3 text-sm font-semibold text-gray-900">
                Recommended AEO Content Proposals
              </div>
              <div className="space-y-2.5">
                {report.contentProposals.map((p) => (
                  <div key={p.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-900">{p.title}</span>
                      <span className="badge bg-brand-50 text-[10px] text-brand-700">
                        {p.status}
                      </span>
                    </div>
                    {p.targetUrl ? (
                      <div className="mt-1 font-mono text-[11px] text-brand-600">{p.targetUrl}</div>
                    ) : null}
                    <div className="mt-1 text-xs text-gray-600">{p.summary}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="metric-card">
              <div className="mb-3 text-sm font-semibold text-gray-900">
                High-Volume Prompt Gaps &amp; Action Plan
              </div>
              <div className="space-y-2.5">
                {report.promptGaps.map((g, i) => (
                  <div key={`${g.prompt}-${i}`} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-900">&ldquo;{g.prompt}&rdquo;</span>
                      <span className="font-mono text-[11px] text-gray-500">
                        {g.volume.toLocaleString()} vol/mo
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">{g.recommendation}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* AEO Content Rewrite Pitch (Before vs After + JSON-LD Schema) */}
        {report.contentRewrite ? (
          <div className="metric-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  AEO Content Rewrite Pitch — Before vs. After
                </div>
                <div className="text-xs text-gray-500">
                  Target URL:{" "}
                  <span className="font-mono text-brand-600">
                    {report.contentRewrite.targetPageUrl}
                  </span>{" "}
                  · Focus Prompt: &ldquo;{report.contentRewrite.focusPrompt}&rdquo;
                </div>
              </div>
              <span className="badge bg-emerald-50 text-xs font-semibold text-emerald-700">
                +{report.contentRewrite.projectedCitationLiftPct}% Projected Citation Lift
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-red-100 bg-red-50/30 p-3.5">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
                  Before (Unoptimized Marketing Copy)
                </div>
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                  {report.contentRewrite.beforeCopy}
                </div>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3.5">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  After (AEO Answer-First &amp; Entity-Rich Copy)
                </div>
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800">
                  {report.contentRewrite.afterCopy}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3.5">
                <div className="mb-2 text-xs font-semibold text-gray-900">
                  Key AEO Structural Improvements
                </div>
                <ul className="list-disc space-y-1.5 pl-4 text-xs text-gray-600">
                  {report.contentRewrite.keyImprovements.map((imp, idx) => (
                    <li key={idx}>{imp}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-900 p-3.5 text-gray-100">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-300">
                  Recommended FAQPage JSON-LD Schema
                </div>
                <pre className="max-h-44 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-300">
                  {report.contentRewrite.jsonLdSchema}
                </pre>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl bg-brand-50 p-6 text-center">
          <div className="text-sm font-medium text-brand-700">
            Want live AI search tracking and automated content briefs for your brand?
          </div>
          <a href="/signup" className="btn-primary mt-3 inline-flex">
            Get your free audit
          </a>
        </div>
      </div>
    </div>
  );
}
