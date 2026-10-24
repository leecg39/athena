/** Report types, chart modules, the public data shape and input normalisation. */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { scheduledReports } from "@athena/db";
import { DomainError } from "../org/errors";

export const REPORT_TYPES = ["ai_search", "content_proposal"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_CADENCES = ["daily", "weekly", "biweekly", "monthly"] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];

/** Days covered by one report, and the interval between scheduled sends. */
export const CADENCE_DAYS: Record<ReportCadence, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
/** Reports look back at least a week so daily digests are not built on a handful of answers. */
export const periodDays = (cadence: ReportCadence) => Math.max(7, CADENCE_DAYS[cadence]);

export const REPORT_CHART_CATALOG = [
  { key: "mention_rate", label: "Brand mention rate", category: "visibility", description: "Share of collected AI answers that mention your brand, by day" },
  { key: "citation_rate", label: "Citation rate", category: "visibility", description: "Share of collected AI answers that cite your domain, by day" },
  { key: "share_of_voice", label: "Share of voice vs competitors", category: "visibility", description: "Your mentions among all tracked brands' mentions (each brand counted once per answer)" },
  { key: "ai_search_value", label: "AI-visible searches", category: "visibility", description: "Search volume of tracked prompts weighted by how often answers mention you (needs volume data)" },
  { key: "top_sources", label: "Top cited domains", category: "sources", description: "Domains cited most often in collected answers" },
  { key: "prompt_gaps", label: "Prompt gaps", category: "content", description: "Tracked prompts whose answers mention your brand in half of the answers or fewer" },
  { key: "content_proposals", label: "Content pipeline", category: "content", description: "Content Hub items and their status" },
  { key: "site_health_summary", label: "AI crawler access", category: "technical", description: "Share of crawled pages that allow AI crawlers (from Site Health)" },
] as const;

export type ReportChartKey = (typeof REPORT_CHART_CATALOG)[number]["key"];
export const VALID_CHART_KEYS = REPORT_CHART_CATALOG.map((c) => c.key) as readonly ReportChartKey[];

export interface ScheduledReportItem {
  id: string;
  websiteId: string;
  name: string;
  shareId: string;
  reportType: ReportType;
  sharePath: string;
  charts: ReportChartKey[];
  recipients: string[];
  cadence: ReportCadence;
  slackChannel: string | null;
  lastSentAt: Date | null;
  createdAt: Date;
}

/** What a public share link, an email or a PDF shows. Unknown values are null, never invented. */
export interface PublicReportData {
  id: string;
  shareId: string;
  name: string;
  reportType: ReportType;
  brandName: string;
  brandDomain: string;
  cadence: ReportCadence;
  charts: ReportChartKey[];
  generatedAt: string;
  period: { from: string; to: string; days: number };
  kpis: {
    responses: number;
    mentionRatePct: number | null;
    citationRatePct: number | null;
    shareOfVoicePct: number | null;
    avgPosition: number | null;
    /** share of answers from the dev-only simulated provider */
    simulatedSharePct: number;
    activePrompts: number;
  };
  searchValue: { hasVolume: boolean; aiVisibleSearches: number; trackedVolume: number };
  daily: { date: string; responses: number; mentionRatePct: number; citationRatePct: number }[];
  competitorSov: { name: string; isOwn: boolean; mentions: number; sovPct: number }[];
  topSources: { domain: string; citations: number; isOwn: boolean }[];
  promptGaps: { prompt: string; answers: number; mentionRatePct: number; volume: number | null }[];
  contentProposals: { id: string; title: string; status: string; targetUrl: string | null; summary: string }[];
  crawler: { pagesChecked: number; aiAccessiblePct: number | null; checkedAt: string | null };
}

export function generateShareId(prefix: "rpt" | "cpr"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function normalizeCharts(raw: readonly string[]): ReportChartKey[] {
  const valid = new Set<string>(VALID_CHART_KEYS);
  return [...new Set(raw.map((k) => k.trim()).filter((k) => valid.has(k)))] as ReportChartKey[];
}

const emailSchema = z.string().trim().toLowerCase().email();

export function normalizeRecipients(raw: readonly string[]): string[] {
  const parts = raw.flatMap((item) => item.split(/[,\s;]+/)).map((p) => p.trim()).filter(Boolean);
  const emails = parts.map((part) => {
    const parsed = emailSchema.safeParse(part);
    if (!parsed.success) throw new DomainError(`Invalid recipient email address: "${part}"`);
    return parsed.data;
  });
  const unique = [...new Set(emails)];
  if (unique.length > 25) throw new DomainError("A report can have at most 25 email recipients");
  return unique;
}

/** The Slack channel label shown for a report (posting goes through the website's Slack webhook). */
export function normalizeSlackChannel(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  const formatted = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!/^#[a-z0-9_-]{2,60}$/i.test(formatted)) throw new DomainError('Slack channel must look like "#aeo-weekly"');
  return formatted.toLowerCase();
}

export function toScheduledReportItem(row: typeof scheduledReports.$inferSelect): ScheduledReportItem {
  const reportType: ReportType = row.reportType === "content_proposal" ? "content_proposal" : "ai_search";
  const charts = normalizeCharts(Array.isArray(row.charts) ? row.charts : []);
  const cadence: ReportCadence = (REPORT_CADENCES as readonly string[]).includes(row.cadence) ? (row.cadence as ReportCadence) : "weekly";
  return {
    id: row.id,
    websiteId: row.websiteId,
    name: row.name,
    shareId: row.shareId,
    reportType,
    sharePath: reportType === "content_proposal" ? `/report/content/${row.shareId}` : `/report/${row.shareId}`,
    charts: charts.length ? charts : ["mention_rate", "citation_rate", "share_of_voice"],
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
    cadence,
    slackChannel: row.slackChannel ?? null,
    lastSentAt: row.lastSentAt,
    createdAt: row.createdAt,
  };
}
