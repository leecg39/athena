import Link from "next/link";
import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import { compareEntities, topicHeatmap, discoverCompetitorCandidates, competitorConflict, type CompetitorEntry } from "@athena/core/competitors";
import { normalizeCompetitorDomain } from "@athena/core/onboarding";
import type { WebsiteRow } from "@athena/core/tenancy";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/lib/workspace";
import { getCompetitorList } from "@/lib/data";
import { ComparisonTable } from "./_sections/comparison";
import { HeatmapSection, type HeatmapMetric } from "./_sections/heatmap";
import { TrackedCompetitors } from "./_sections/tracked";
import { DiscoveredCompetitors } from "./_sections/discovered";

export const metadata = { title: "Competitors" };

const RANGES = ["7d", "14d", "30d", "90d"] as const;

function windowFor(range?: string) {
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "90d" ? 90 : 30;
  const to = new Date();
  return { range: `${days}d`, filters: { from: new Date(to.getTime() - days * 86_400_000), to } };
}

function normalizedOrNull(domain: string): string | null {
  try {
    return normalizeCompetitorDomain(domain);
  } catch {
    return null;
  }
}

/** Onboarding suggestions the shared competitor rules would still accept, de-duplicated (never calls an LLM). */
function acceptableSuggestions(site: WebsiteRow, tracked: CompetitorEntry[], suggested: { name: string; domain: string }[]): CompetitorEntry[] {
  return suggested.reduce<CompetitorEntry[]>((acc, s) => {
    const domain = normalizedOrNull(s.domain);
    if (!domain) return acc;
    const entry = { name: s.name.trim(), domain };
    return competitorConflict(site, [...tracked, ...acc], entry) ? acc : [...acc, entry];
  }, []);
}

function RangeBar({ range, total, href }: { range: string; total: number; href: (r: string) => string }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {RANGES.map((r) => (
        <Link key={r} href={href(r)} className={`badge ${range === r ? "bg-brand-50 text-brand-600" : "bg-gray-100 text-gray-600"}`}>
          Last {r.replace("d", " days")}
        </Link>
      ))}
      <span className="text-gray-400">{total} answers</span>
    </div>
  );
}

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<{ range?: string; metric?: string }> }) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const { range, filters } = windowFor(sp.range);
  const metric: HeatmapMetric = sp.metric === "citation" ? "citation" : "mention";
  const c = { actorId: ws.user.id, websiteId: ws.websiteId, filters };
  const [membership, tracked, comparison, heatmap, candidates] = await Promise.all([
    getMembership(db, ws.user.id, ws.organizationId),
    getCompetitorList(ws.websiteId),
    compareEntities(db, c),
    topicHeatmap(db, c),
    discoverCompetitorCandidates(db, c),
  ]);
  const canWrite = membership?.permissions.includes("prompts:write") ?? false;
  const ai = ws.website.profile?.suggestions?.competitors;
  const href = (patch: Record<string, string>) => `/competitors?${new URLSearchParams({ range, metric, ...patch }).toString()}`;
  return (
    <div>
      <PageHeader title="Competitors" subtitle="How your brand compares with competitors in AI answers" />
      <div className="space-y-6 p-6">
        <RangeBar range={range} total={comparison.totalResponses} href={(r) => href({ range: r })} />
        <ComparisonTable entities={comparison.entities} />
        <HeatmapSection heatmap={heatmap} metric={metric} hrefFor={(m) => href({ metric: m })} />
        <div className="grid gap-6 lg:grid-cols-2">
          <TrackedCompetitors tracked={tracked} canWrite={canWrite} />
          <DiscoveredCompetitors candidates={candidates} suggestions={acceptableSuggestions(ws.website, tracked, ai?.data ?? [])} provider={ai?.provider} canWrite={canWrite} />
        </div>
      </div>
    </div>
  );
}
