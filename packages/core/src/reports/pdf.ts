/**
 * Single-page %PDF-1.4 export of a report. Uses the standard Helvetica font,
 * so only ASCII text is rendered (other characters become "?").
 */
import type { PublicReportData } from "./catalog";
import { reportSummaryLines } from "./delivery";

const RULE = "------------------------------------------------------------------------";

function escapePdfText(input: string): string {
  return input
    .replace(/[—–]/g, "-")
    .replace(/·/g, "|")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function sections(data: PublicReportData): string[] {
  const charts = new Set(data.charts);
  const sov = charts.has("share_of_voice") && data.competitorSov.length ? [RULE, "SHARE OF VOICE", ...data.competitorSov.map((c, i) => `  ${i + 1}. ${c.name}${c.isOwn ? " (you)" : ""}: ${c.sovPct}% (${c.mentions} mentions)`)] : [];
  const sources = charts.has("top_sources") && data.topSources.length ? [RULE, "TOP CITED DOMAINS", ...data.topSources.map((s, i) => `  ${i + 1}. ${s.domain}${s.isOwn ? " (you)" : ""}: ${s.citations} citations`)] : [];
  const gaps = charts.has("prompt_gaps") && data.promptGaps.length ? [RULE, "PROMPT GAPS", ...data.promptGaps.map((g, i) => `  ${i + 1}. "${g.prompt}" - mentioned in ${g.mentionRatePct}% of ${g.answers} answers${g.volume ? `, ${g.volume} searches/mo` : ""}`)] : [];
  const pipeline = charts.has("content_proposals") && data.contentProposals.length ? [RULE, "CONTENT PIPELINE", ...data.contentProposals.slice(0, 5).map((p, i) => `  ${i + 1}. [${p.status}] ${p.title}${p.targetUrl ? ` (${p.targetUrl})` : ""}`)] : [];
  const value = charts.has("ai_search_value") ? [data.searchValue.hasVolume ? `AI-visible searches: ${data.searchValue.aiVisibleSearches} of ${data.searchValue.trackedVolume} tracked monthly searches` : "AI-visible searches: no search volume data for tracked prompts"] : [];
  const crawler = charts.has("site_health_summary") ? [data.crawler.pagesChecked ? `AI crawler access: ${data.crawler.aiAccessiblePct}% of ${data.crawler.pagesChecked} crawled pages` : "AI crawler access: not checked yet (run a Site Health crawl)"] : [];
  return [...value, ...crawler, ...sov, ...sources, ...gaps, ...pipeline];
}

function pdfDocument(lines: string[]): Buffer {
  const ops = ["BT", "/F1 14 Tf", "48 750 Td", ...lines.flatMap((line, i) => [...(i === 1 ? ["/F1 9 Tf", "0 -18 Td"] : i > 1 ? ["0 -14 Td"] : []), `(${escapePdfText(line.slice(0, 100))}) Tj`]), "ET"];
  const stream = ops.join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  const header = "%PDF-1.4\n";
  const offsets = objects.reduce<number[]>((acc, _obj, i) => [...acc, i === 0 ? Buffer.byteLength(header) : acc[i - 1]! + Buffer.byteLength(objects[i - 1]!)], []);
  const body = header + objects.join("");
  const xrefAt = Buffer.byteLength(body);
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  return Buffer.from(`${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, "utf8");
}

export function renderReportPdfBuffer(data: PublicReportData): Buffer {
  const [title, ...summary] = reportSummaryLines(data);
  const lines = [
    title ?? data.name,
    `Report: ${data.reportType === "content_proposal" ? "Content proposal" : "AI search visibility"} | Generated ${data.generatedAt.slice(0, 16).replace("T", " ")} UTC`,
    `Period: ${data.period.from.slice(0, 10)} to ${data.period.to.slice(0, 10)}`,
    RULE,
    ...summary.flatMap((l) => (l.startsWith("Mention rate") ? l.split(" · ") : [l])),
    ...(data.kpis.responses ? [] : ["Mention rate: -", "Citation rate: -", "Share of voice: -"]),
    ...sections(data),
  ];
  return pdfDocument(lines);
}
