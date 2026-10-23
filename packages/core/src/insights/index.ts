/**
 * Proactive AI Insights engine:
 *  - Evaluates workspace visibility, source citations, lost prompts, topic heatmaps,
 *    and competitor movements over a rolling lookback window (default 30d vs prior 30d).
 *  - Emits deterministic, signal-keyed insights across three core categories:
 *      1. "opportunity"     — high-impact third-party/community citation gaps & uncited brand mentions
 *      2. "gap"             — prompts & topics where competitors are recommended without the brand
 *      3. "competitor_move" — competitor mention/SoV surges, competitor leads, and brand visibility drops
 *  - Serializes generation per website via row lock, updates active insights in place,
 *    and respects user-resolved / discarded insights so they do not resurface automatically.
 */
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { type Db, insights, websites, responses, prompts, responseMentions, competitors } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { visibilityForSite, compareTotals } from "../analytics/visibility";
import { conditions, type VisibilityFilters } from "../analytics/filters";
import { listSourcesForSite } from "../sources/analytics";
import { compareEntitiesForSite, topicHeatmapForSite } from "../competitors/analytics";

export const INSIGHT_KINDS = ["opportunity", "gap", "competitor_move", "integrity"] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const INSIGHT_STATUSES = ["active", "resolved", "discarded"] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export interface InsightAction {
  signalKey?: string;
  label?: string;
  href?: string;
  askPrompt?: string;
  metrics?: Record<string, string | number | null>;
  updatedAt?: string;
}

export interface InsightRow {
  id: string;
  websiteId: string;
  title: string;
  body: string;
  kind: InsightKind;
  status: InsightStatus;
  action: InsightAction;
  createdAt: Date;
}

export interface InsightListResult {
  rows: InsightRow[];
  counts: {
    active: number;
    resolved: number;
    discarded: number;
    total: number;
  };
  kindCounts: Record<InsightKind, number>;
}

const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

function truncate(text: string, max = 56): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function safeHref(href: unknown): string | undefined {
  if (typeof href !== "string") return undefined;
  if (!href.startsWith("/") || href.startsWith("//")) return undefined;
  return href;
}

function parseAction(raw: unknown): InsightAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    signalKey: typeof obj.signalKey === "string" ? obj.signalKey : undefined,
    label: typeof obj.label === "string" ? obj.label : undefined,
    href: safeHref(obj.href),
    askPrompt: typeof obj.askPrompt === "string" ? obj.askPrompt : undefined,
    metrics: obj.metrics && typeof obj.metrics === "object" && !Array.isArray(obj.metrics) ? (obj.metrics as Record<string, string | number | null>) : undefined,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
  };
}

function toInsightRow(row: typeof insights.$inferSelect): InsightRow {
  const kind = (INSIGHT_KINDS as readonly string[]).includes(row.kind) ? (row.kind as InsightKind) : "opportunity";
  return {
    id: row.id,
    websiteId: row.websiteId,
    title: row.title,
    body: row.body,
    kind,
    status: row.status,
    action: parseAction(row.action),
    createdAt: row.createdAt,
  };
}

interface CandidateInsight {
  signalKey: string;
  kind: InsightKind;
  title: string;
  body: string;
  action: InsightAction;
}

async function lostPromptsForSite(db: Db, site: WebsiteRow, filters: VisibilityFilters) {
  const where = and(...conditions(site.id, filters));
  const lostAnswer = sql`not ${responses.mentioned} and exists (select 1 from ${responseMentions} inner join ${competitors} on ${competitors.id} = ${responseMentions.competitorId} and ${competitors.deletedAt} is null where ${responseMentions.responseId} = ${responses.id})`;
  const [rows, names] = await Promise.all([
    db
      .select({
        id: prompts.id,
        prompt: prompts.text,
        answers: sql<number>`count(*)::int`,
        lost: sql<number>`(count(*) filter (where ${lostAnswer}))::int`,
      })
      .from(responses)
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(where)
      .groupBy(prompts.id, prompts.text),
    db
      .selectDistinct({ promptId: responses.promptId, name: competitors.name })
      .from(responseMentions)
      .innerJoin(competitors, and(eq(competitors.id, responseMentions.competitorId), isNull(competitors.deletedAt)))
      .innerJoin(responses, eq(responses.id, responseMentions.responseId))
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .where(and(where, eq(responses.mentioned, false))),
  ]);
  return rows
    .filter((r) => r.lost > 0)
    .sort((a, b) => b.lost - a.lost || b.answers - a.answers || a.prompt.localeCompare(b.prompt))
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      prompt: r.prompt,
      answers: r.answers,
      lost: r.lost,
      competitors: names
        .filter((x) => x.promptId === r.id)
        .map((x) => x.name)
        .sort(),
    }));
}

async function buildInsightCandidates(
  db: Db,
  site: WebsiteRow,
  opts: { days: number; now: Date },
): Promise<{ totalResponses: number; candidates: CandidateInsight[] }> {
  const to = opts.now;
  const from = new Date(to.getTime() - opts.days * DAY);
  const current: VisibilityFilters = { from, to };
  const previous: VisibilityFilters = { from: new Date(from.getTime() - opts.days * DAY), to: from };

  const [curVis, prevVis, sources, lost, heat, curComp, prevComp] = await Promise.all([
    visibilityForSite(db, site, current),
    visibilityForSite(db, site, previous),
    listSourcesForSite(db, site, { filters: current, limit: 100 }),
    lostPromptsForSite(db, site, current),
    topicHeatmapForSite(db, site, current),
    compareEntitiesForSite(db, site, current),
    compareEntitiesForSite(db, site, previous),
  ]);

  if (curVis.totals.responses === 0) return { totalResponses: 0, candidates: [] };

  const updatedAt = to.toISOString();
  const candidates: CandidateInsight[] = [];

  // 1A. Opportunity: third-party / community / partner sources citing competitors more than the brand
  const gapSources = sources.rows
    .filter((s) => s.type !== "owned" && s.type !== "competitor")
    .map((s) => ({
      ...s,
      gap: round1(s.competitorMentionPct - s.brandMentionPct),
    }))
    .filter((s) => s.gap >= 10 || (s.brandMentionPct === 0 && s.competitorMentionPct > 0))
    .sort((a, b) => b.responses - a.responses || b.gap - a.gap || a.rootDomain.localeCompare(b.rootDomain))
    .slice(0, 3);

  for (const s of gapSources) {
    const signalKey = `opportunity:source:${s.rootDomain}`;
    const title =
      s.brandMentionPct === 0
        ? `Missing from ${s.rootDomain} (${s.citationPct}% citation share)`
        : `Citation gap on ${s.rootDomain} (${s.competitorMentionPct}% competitor vs ${s.brandMentionPct}% ${site.name})`;
    const body = `${s.rootDomain} is cited in ${s.responses} of ${sources.totalResponses} AI answers (${s.citationPct}% citation rate), where competitors are mentioned ${s.competitorMentionPct}% of the time compared to ${s.brandMentionPct}% for ${site.name}. Earning coverage or a mention on ${s.rootDomain} can lift AI visibility across those answers.`;
    candidates.push({
      signalKey,
      kind: "opportunity",
      title,
      body,
      action: {
        signalKey,
        label: "Inspect source",
        href: `/sources/${encodeURIComponent(s.rootDomain)}`,
        askPrompt: `Which pages on ${s.rootDomain} are AI models citing, and how can ${site.name} earn a mention there?`,
        metrics: {
          domain: s.rootDomain,
          responses: s.responses,
          citationRate: s.citationPct,
          brandMentionRate: s.brandMentionPct,
          competitorMentionRate: s.competitorMentionPct,
        },
        updatedAt,
      },
    });
  }

  // 1B. Opportunity: uncited brand mentions (high mention rate vs low domain citation rate)
  const mentionCitationGap = round1(curVis.totals.mentionRate - curVis.totals.citationRate);
  if (curVis.totals.responses >= 2 && mentionCitationGap >= 15) {
    const signalKey = "opportunity:uncited-mentions";
    candidates.push({
      signalKey,
      kind: "opportunity",
      title: `Convert ${mentionCitationGap}pt uncited mention gap into domain citations`,
      body: `${site.name} is mentioned in ${curVis.totals.mentionRate}% of sampled AI answers (${curVis.totals.responses} responses) but ${site.domain} is cited in only ${curVis.totals.citationRate}%. Publishing authoritative reference pages, schema markup, and direct answer blocks on ${site.domain} can turn unlinked mentions into direct citations.`,
      action: {
        signalKey,
        label: "Review sources",
        href: "/sources",
        askPrompt: `Why is ${site.name} mentioned (${curVis.totals.mentionRate}%) much more often than ${site.domain} is cited (${curVis.totals.citationRate}%), and which pages should we publish?`,
        metrics: {
          mentionRate: curVis.totals.mentionRate,
          citationRate: curVis.totals.citationRate,
          gapPts: mentionCitationGap,
          responses: curVis.totals.responses,
        },
        updatedAt,
      },
    });
  }

  // 2A. Content Gap: prompts where competitors are recommended without the brand
  for (const p of lost.slice(0, 3)) {
    const signalKey = `gap:prompt:${p.id}`;
    const lossPct = pct(p.lost, p.answers);
    const compList = p.competitors.slice(0, 3).join(", ");
    candidates.push({
      signalKey,
      kind: "gap",
      title: `Content gap on "${truncate(p.prompt, 56)}" (${p.lost}/${p.answers} answers lost)`,
      body: `In ${p.lost} of ${p.answers} AI answers (${lossPct}%) for "${p.prompt}", AI models recommended ${compList || "competitors"} without mentioning ${site.name}. Creating a targeted guide or comparison page addressing this query can capture these recommendations.`,
      action: {
        signalKey,
        label: "Create content",
        href: "/content",
        askPrompt: `Draft an AI-optimized content brief for the prompt "${p.prompt}" where ${compList || "competitors"} are currently beating ${site.name}.`,
        metrics: {
          prompt: p.prompt,
          lostAnswers: p.lost,
          totalAnswers: p.answers,
          lossRate: lossPct,
          competitors: compList || null,
        },
        updatedAt,
      },
    });
  }

  // 2B. Content Gap: topics where a competitor leads the brand by >= 10 percentage points
  const weakTopics = heat.topics
    .map((t, ti) => {
      const rates = heat.mention[ti] ?? [];
      const brandRate = rates[0] ?? 0;
      const leader = heat.entities.slice(1).reduce<{ name: string; mentionRate: number } | null>((best, e, ei) => {
        const r = rates[ei + 1] ?? 0;
        return !best || r > best.mentionRate ? { name: e.name, mentionRate: r } : best;
      }, null);
      const gapPts = leader ? round1(leader.mentionRate - brandRate) : 0;
      return { id: t.id, name: t.name, responses: t.responses, brandRate, leader, gapPts };
    })
    .filter((t) => t.id !== null && t.responses >= 2 && t.leader !== null && t.gapPts >= 10)
    .sort((a, b) => b.gapPts - a.gapPts || b.responses - a.responses)
    .slice(0, 2);

  for (const t of weakTopics) {
    const signalKey = `gap:topic:${t.id}`;
    const leader = t.leader!;
    candidates.push({
      signalKey,
      kind: "gap",
      title: `${leader.name} leads "${t.name}" topic by ${t.gapPts} pts (${leader.mentionRate}% vs ${t.brandRate}%)`,
      body: `Across ${t.responses} answers in the "${t.name}" topic, ${leader.name} is mentioned in ${leader.mentionRate}% of responses compared to ${t.brandRate}% for ${site.name}. Expanding topic-specific pillar content and FAQs for "${t.name}" can close this ${t.gapPts}pt visibility gap.`,
      action: {
        signalKey,
        label: "Inspect prompts",
        href: "/prompts",
        askPrompt: `How can ${site.name} close the ${t.gapPts}pt mention gap against ${leader.name} in the "${t.name}" topic?`,
        metrics: {
          topic: t.name,
          responses: t.responses,
          brandMentionRate: t.brandRate,
          leader: leader.name,
          leaderMentionRate: leader.mentionRate,
          gapPts: t.gapPts,
        },
        updatedAt,
      },
    });
  }

  // 3A. Competitor Moves: competitor mention rate surge vs previous period or lead over brand
  const brandEntity = curComp.entities.find((e) => e.competitorId === null);
  const compEntities = curComp.entities.filter((e) => e.competitorId !== null);
  const prevByComp = new Map(
    prevComp.entities.filter((e) => e.competitorId !== null).map((e) => [e.competitorId!, e]),
  );

  if (prevComp.totalResponses > 0) {
    const surging = compEntities
      .map((e) => {
        const prev = prevByComp.get(e.competitorId!);
        const delta = prev ? round1(e.mentionRate - prev.mentionRate) : 0;
        return { entity: e, prevRate: prev?.mentionRate ?? 0, delta };
      })
      .filter((x) => x.delta >= 5)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 2);

    for (const { entity: e, prevRate, delta } of surging) {
      const signalKey = `competitor_move:surge:${e.competitorId}`;
      candidates.push({
        signalKey,
        kind: "competitor_move",
        title: `${e.name} mention rate surged +${delta} pts to ${e.mentionRate}%`,
        body: `${e.name} climbed from ${prevRate}% to ${e.mentionRate}% mention rate (+${delta} pts) over the last ${opts.days} days, holding ${e.shareOfVoice}% share of voice${e.avgPosition !== null ? ` at avg position #${e.avgPosition}` : ""}. Review the prompts and sources driving ${e.name}'s gain.`,
        action: {
          signalKey,
          label: "Compare competitors",
          href: "/competitors",
          askPrompt: `Compare ${site.name} with ${e.name} and explain why ${e.name} gained visibility recently.`,
          metrics: {
            competitor: e.name,
            mentionRate: e.mentionRate,
            previousMentionRate: prevRate,
            deltaPts: delta,
            shareOfVoice: e.shareOfVoice,
          },
          updatedAt,
        },
      });
    }
  }

  if (brandEntity) {
    const leaders = compEntities
      .map((e) => ({ entity: e, leadPts: round1(e.mentionRate - brandEntity.mentionRate) }))
      .filter((x) => x.leadPts > 0)
      .sort((a, b) => b.leadPts - a.leadPts)
      .slice(0, 2);

    for (const { entity: e, leadPts } of leaders) {
      const signalKey = `competitor_move:lead:${e.competitorId}`;
      candidates.push({
        signalKey,
        kind: "competitor_move",
        title: `${e.name} leads ${site.name} by ${leadPts} pts in AI mentions (${e.mentionRate}% vs ${brandEntity.mentionRate}%)`,
        body: `${e.name} appears in ${e.mentionRate}% of AI answers (${e.shareOfVoice}% share of voice${e.avgPosition !== null ? `, avg position #${e.avgPosition}` : ""}) compared to ${site.name}'s ${brandEntity.mentionRate}% (${brandEntity.shareOfVoice}% SoV). Publishing head-to-head comparison pages and targeting shared citations can recapture share of voice.`,
        action: {
          signalKey,
          label: "Compare competitors",
          href: "/competitors",
          askPrompt: `Compare ${site.name} against ${e.name} and recommend actions to overtake their ${e.mentionRate}% mention rate.`,
          metrics: {
            competitor: e.name,
            competitorMentionRate: e.mentionRate,
            brandMentionRate: brandEntity.mentionRate,
            leadPts,
            competitorSoV: e.shareOfVoice,
            brandSoV: brandEntity.shareOfVoice,
          },
          updatedAt,
        },
      });
    }

    // If no competitor beats the brand on mention rate, check if a competitor ranks higher in avg list position
    if (leaders.length === 0 && brandEntity.avgPosition !== null) {
      const outranking = compEntities
        .filter((e) => e.mentions >= 2 && e.avgPosition !== null && round1(brandEntity.avgPosition! - e.avgPosition) >= 0.3)
        .sort((a, b) => (a.avgPosition ?? 99) - (b.avgPosition ?? 99))
        .slice(0, 1);

      for (const e of outranking) {
        const signalKey = `competitor_move:position:${e.competitorId}`;
        candidates.push({
          signalKey,
          kind: "competitor_move",
          title: `${e.name} ranks higher than ${site.name} (#${e.avgPosition} vs #${brandEntity.avgPosition} avg position)`,
          body: `When mentioned in AI answers (${e.mentionRate}% mention rate), ${e.name} is placed at average position #${e.avgPosition} compared to #${brandEntity.avgPosition} for ${site.name} (${brandEntity.mentionRate}% mention rate). Strengthening top-of-page comparison tables and third-party review citations can lift ${site.name} to #1.`,
          action: {
            signalKey,
            label: "Compare competitors",
            href: "/competitors",
            askPrompt: `Why does ${e.name} rank higher (#${e.avgPosition}) than ${site.name} (#${brandEntity.avgPosition}) in AI answers?`,
            metrics: {
              competitor: e.name,
              competitorAvgPosition: e.avgPosition,
              brandAvgPosition: brandEntity.avgPosition,
              competitorMentionRate: e.mentionRate,
            },
            updatedAt,
          },
        });
      }
    }
  }

  // 3B. Competitor Moves: brand mention rate drop vs previous period
  const visDelta = compareTotals(curVis.totals, prevVis.totals);
  if (visDelta && visDelta.mentionRate <= -5) {
    const dropPts = Math.abs(visDelta.mentionRate);
    const signalKey = "competitor_move:brand-drop";
    candidates.push({
      signalKey,
      kind: "competitor_move",
      title: `${site.name} mention rate dropped ${dropPts} pts vs previous ${opts.days} days`,
      body: `${site.name}'s mention rate fell from ${prevVis.totals.mentionRate}% to ${curVis.totals.mentionRate}% (${visDelta.mentionRate} pts) across ${curVis.totals.responses} sampled answers, with share of voice at ${curVis.totals.shareOfVoice}%. Inspect recent responses by model to identify where competitors replaced ${site.name}.`,
      action: {
        signalKey,
        label: "View dashboard",
        href: "/olympus",
        askPrompt: `Why did ${site.name}'s mention rate drop by ${dropPts} percentage points over the last ${opts.days} days?`,
        metrics: {
          mentionRate: curVis.totals.mentionRate,
          previousMentionRate: prevVis.totals.mentionRate,
          deltaPts: visDelta.mentionRate,
          shareOfVoice: curVis.totals.shareOfVoice,
        },
        updatedAt,
      },
    });
  }

  return { totalResponses: curVis.totals.responses, candidates };
}

const generateSiteSchema = z.object({
  websiteId: z.string().uuid(),
  days: z.number().int().min(7).max(90).default(30),
  now: z.date().optional(),
});

const generateSchema = generateSiteSchema.extend({
  actorId: z.string().uuid(),
});

export interface GenerateInsightsResult {
  created: number;
  updated: number;
  skipped: number;
  insights: InsightRow[];
}

async function executeGenerateInsights(
  db: Db,
  site: WebsiteRow,
  opts: { days: number; now: Date; actorId?: string },
): Promise<GenerateInsightsResult> {
  const { now } = opts;

  return db.transaction(async (tx) => {
    // Serialize concurrent insight generation and read consistent snapshot under website lock
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");

    const { totalResponses, candidates } = await buildInsightCandidates(tx, site, { days: opts.days, now });
    if (totalResponses === 0) {
      return { created: 0, updated: 0, skipped: 0, insights: [] };
    }

    const existing = await tx
      .select()
      .from(insights)
      .where(eq(insights.websiteId, site.id))
      .orderBy(desc(insights.createdAt), desc(insights.id));

    const activeByKey = new Map<string, typeof insights.$inferSelect>();
    const duplicateActiveIds: string[] = [];
    const closedKeys = new Set<string>();
    for (const row of existing) {
      const key = parseAction(row.action).signalKey;
      if (!key) continue;
      if (row.status === "active") {
        if (!activeByKey.has(key)) activeByKey.set(key, row);
        else duplicateActiveIds.push(row.id);
      } else {
        closedKeys.add(key);
      }
    }

    for (const dupId of duplicateActiveIds) {
      await tx.delete(insights).where(eq(insights.id, dupId));
    }

    const candidateKeys = new Set(candidates.map((c) => c.signalKey));
    for (const [key, activeRow] of activeByKey.entries()) {
      if (!candidateKeys.has(key)) {
        // Signal is no longer active in current metrics (e.g. gap closed or competitor removed)
        await tx
          .update(insights)
          .set({ status: "resolved" })
          .where(eq(insights.id, activeRow.id));
        activeByKey.delete(key);
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const cand of candidates) {
      const activeRow = activeByKey.get(cand.signalKey);
      if (activeRow) {
        await tx
          .update(insights)
          .set({
            title: cand.title,
            body: cand.body,
            kind: cand.kind,
            action: cand.action as Record<string, unknown>,
          })
          .where(eq(insights.id, activeRow.id));
        updated++;
      } else if (closedKeys.has(cand.signalKey)) {
        // User resolved or discarded this signal; do not recreate it automatically
        skipped++;
      } else {
        await tx.insert(insights).values({
          websiteId: site.id,
          title: cand.title,
          body: cand.body,
          kind: cand.kind,
          status: "active",
          action: cand.action as Record<string, unknown>,
        });
        created++;
      }
    }

    if (opts.actorId && (created > 0 || updated > 0)) {
      await logActivity(tx, {
        organizationId: site.organizationId,
        userId: opts.actorId,
        websiteId: site.id,
        entityType: "insight",
        change: "generated",
        after: { created, updated, skipped },
      });
    }

    const activeRows = await tx
      .select()
      .from(insights)
      .where(and(eq(insights.websiteId, site.id), eq(insights.status, "active")))
      .orderBy(desc(insights.createdAt), desc(insights.id));

    return {
      created,
      updated,
      skipped,
      insights: activeRows.map(toInsightRow),
    };
  });
}

export async function generateInsightsForSite(
  db: Db,
  rawInput: { websiteId: string; days?: number; now?: Date },
): Promise<GenerateInsightsResult> {
  const input = generateSiteSchema.parse(rawInput);
  const [site] = await db.select().from(websites).where(and(eq(websites.id, input.websiteId), isNull(websites.deletedAt)));
  if (!site) throw new NotFoundError("Website not found");
  return executeGenerateInsights(db, site, { days: input.days, now: input.now ?? new Date() });
}

export async function generateInsights(
  db: Db,
  rawInput: { actorId: string; websiteId: string; days?: number; now?: Date },
): Promise<GenerateInsightsResult> {
  const input = generateSchema.parse(rawInput);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:write");
  return executeGenerateInsights(db, site, { days: input.days, now: input.now ?? new Date(), actorId: input.actorId });
}

const listSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  status: z.enum(INSIGHT_STATUSES).optional(),
  kind: z.enum(INSIGHT_KINDS).optional(),
});

export async function listInsights(
  db: Db,
  rawInput: { actorId: string; websiteId: string; status?: InsightStatus; kind?: InsightKind },
): Promise<InsightListResult> {
  const input = listSchema.parse(rawInput);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");

  const allRows = await db
    .select()
    .from(insights)
    .where(eq(insights.websiteId, site.id))
    .orderBy(desc(insights.createdAt), desc(insights.id));

  const parsed = allRows.map(toInsightRow);
  const counts = {
    active: 0,
    resolved: 0,
    discarded: 0,
    total: parsed.length,
  };
  for (const r of parsed) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  const statusFiltered = input.status ? parsed.filter((r) => r.status === input.status) : parsed;
  const kindCounts: Record<InsightKind, number> = {
    opportunity: 0,
    gap: 0,
    competitor_move: 0,
    integrity: 0,
  };
  for (const r of statusFiltered) {
    kindCounts[r.kind] = (kindCounts[r.kind] ?? 0) + 1;
  }

  const rows = input.kind ? statusFiltered.filter((r) => r.kind === input.kind) : statusFiltered;
  return { rows, counts, kindCounts };
}

const updateStatusSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  insightId: z.string().uuid(),
  status: z.enum(INSIGHT_STATUSES),
});

export async function updateInsightStatus(
  db: Db,
  rawInput: { actorId: string; websiteId: string; insightId: string; status: InsightStatus },
): Promise<InsightRow> {
  let input: z.infer<typeof updateStatusSchema>;
  try {
    input = updateStatusSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid insight status request");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:write");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(insights)
      .where(and(eq(insights.id, input.insightId), eq(insights.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Insight not found");

    if (existing.status === input.status) {
      return toInsightRow(existing);
    }

    const [updated] = await tx
      .update(insights)
      .set({ status: input.status })
      .where(and(eq(insights.id, input.insightId), eq(insights.websiteId, site.id)))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "insight",
      entityId: updated.id,
      change: input.status,
      before: { status: existing.status },
      after: { status: updated.status, title: updated.title, kind: updated.kind },
    });

    return toInsightRow(updated);
  });
}
