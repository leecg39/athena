/**
 * Inngest functions: scheduled response collection, metric/source aggregation,
 * insight generation, oracle scanning, weekly reports.
 * These are wired into apps/web via /api/inngest.
 */
import { inngest } from "./inngest.js";
import { db } from "@athena/db";
import {
  runs,
  websites,
  prompts,
  promptSchedules,
  responses,
  responseMentions,
  responseCitations,
  sources,
  insights,
  kbFacts,
  oracleFindings,
  scheduledReports,
} from "@athena/db";
import { collectBatch } from "@athena/llm/collector";
import { and, eq, gte, inArray, isNull, sql, desc } from "drizzle-orm";

/** Free/Starter default model matrix (collection runs over these). */
export const DEFAULT_MODELS = ["chatgpt", "perplexity", "ai_overview", "gemini", "copilot"];

/** Kick off a collection run for a website (returns workflow/run id). */
export async function startCollection(websiteId: string, promptIds?: string[]): Promise<string> {
  const [website] = await db.select().from(websites).where(eq(websites.id, websiteId));
  if (!website) throw new Error(`website ${websiteId} not found`);

  const promptRows = promptIds
    ? await db
        .select()
        .from(prompts)
        .where(and(eq(prompts.websiteId, websiteId), inArray(prompts.id, promptIds), eq(prompts.status, "active")))
    : await db
        .select()
        .from(prompts)
        .where(and(eq(prompts.websiteId, websiteId), eq(prompts.status, "active")));

  const [run] = await db
    .insert(runs)
    .values({
      websiteId,
      totalResponses: promptRows.length * DEFAULT_MODELS.length,
      creditsReserved: promptRows.length * DEFAULT_MODELS.length,
    })
    .returning();

  const wf = await inngest.send({
    name: "run/collect",
    data: { runId: run.id, websiteId, promptIds: promptRows.map((p) => p.id), models: DEFAULT_MODELS },
  });
  await db.update(runs).set({ workflowId: wf.ids?.[0] ?? null }).where(eq(runs.id, run.id));
  return run.id;
}

export const collectFn = inngest.createFunction(
  { id: "run-collect", retries: 1 },
  { event: "run/collect" },
  async ({ event }) => {
    const { runId, websiteId, promptIds, models } = event.data as {
      runId: string;
      websiteId: string;
      promptIds: string[];
      models: string[];
    };
    const stored = await collectBatch({ runId, websiteId, promptIds, models });
    await reaggregateSources(websiteId);
    return { stored };
  },
);

/** Rebuild per-domain source aggregates from raw citations (last 30 days). */
export async function reaggregateSources(websiteId: string): Promise<void> {
  const since = new Date(Date.now() - 30 * 86400_000);
  const rows = await db
    .select({
      domain: responseCitations.domain,
      citations: sql<number>`count(*)::int`,
      responses: sql<number>`count(distinct ${responseCitations.responseId})::int`,
    })
    .from(responseCitations)
    .innerJoin(responses, eq(responses.id, responseCitations.responseId))
    .where(and(eq(responses.websiteId, websiteId), gte(responses.ranAt, since)))
    .groupBy(responseCitations.domain);

  if (!rows.length) return;

  // classify source types by known community/owned patterns (simple heuristic)
  const community = new Set(["reddit.com", "youtube.com", "quora.com", "stackexchange.com", "news.ycombinator.com"]);
  const [website] = await db.select().from(websites).where(eq(websites.id, websiteId));
  for (const r of rows) {
    const type = r.domain === website?.domain ? "o" : community.has(r.domain) ? "c" : "t";
    await db
      .insert(sources)
      .values({
        websiteId,
        domain: r.domain,
        type,
        citationCount: r.citations,
        responsesInfluenced: r.responses,
        mentionInfluenced: r.responses,
        competitorMentionPct: "0",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sources.websiteId, sources.domain],
        set: {
          citationCount: r.citations,
          responsesInfluenced: r.responses,
          mentionInfluenced: r.responses,
          type,
          updatedAt: new Date(),
        },
      });
  }
}

export const reaggregateFn = inngest.createFunction(
  { id: "sources-reaggregate", retries: 2 },
  { event: "sources/reaggregate" },
  async ({ event }) => {
    await reaggregateSources((event.data as { websiteId: string }).websiteId);
  },
);

/** Nightly cron: start collection for every active website (default schedule). */
export const nightlyCollections = inngest.createFunction(
  { id: "schedule-nightly-collections" },
  { cron: "TZ=UTC 2H * * *" },
  async () => {
    const sites = await db
      .select({ id: websites.id })
      .from(websites)
      .where(isNull(websites.deletedAt));
    const started: string[] = [];
    for (const s of sites) {
      started.push(await startCollection(s.id));
    }
    return { started: started.length };
  },
);

/** Hourly: generate proactive insights for active websites from recent metric movement. */
export const generateInsights = inngest.createFunction(
  { id: "insights-generate" },
  { cron: "TZ=UTC 30 */6 * * *" },
  async () => {
    const sites = await db.select().from(websites).where(isNull(websites.deletedAt));
    let created = 0;
    for (const site of sites) {
      const since = new Date(Date.now() - 7 * 86400_000);
      const rows = await db
        .select({ id: responses.id, mentioned: responses.mentioned, cited: responses.cited, ranAt: responses.ranAt })
        .from(responses)
        .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, since)));
      if (!rows.length) continue;
      const citePct = (rows.filter((r) => r.cited).length / rows.length) * 100;
      const mentionPct = (rows.filter((r) => r.mentioned).length / rows.length) * 100;

      if (mentionPct < 40) {
        await db.insert(insights).values({
          websiteId: site.id,
          title: "Mention rate below healthy range",
          body: `Only ${mentionPct.toFixed(1)}% of sampled AI responses mention your brand in the last 7 days. Focus on comparison and "best of" prompts where competitors dominate.`,
          kind: "opportunity",
        });
        created++;
      }
      if (citePct < 10) {
        await db.insert(insights).values({
          websiteId: site.id,
          title: "Low citation rate detected",
          body: `Your content was cited in ${citePct.toFixed(1)}% of responses. Publish source-first assets for high-impact prompts and pursue citation outreach on the top-cited domains.`,
          kind: "gap",
        });
        created++;
      }
    }
    return { created };
  },
);

/** Oracle scan: compare recent AI responses against confirmed KB facts. */
export const oracleScan = inngest.createFunction(
  { id: "oracle-scan" },
  { event: "oracle/scan" },
  async ({ event }) => {
    const { websiteId } = event.data as { websiteId: string };
    const facts = await db
      .select()
      .from(kbFacts)
      .where(and(eq(kbFacts.websiteId, websiteId), eq(kbFacts.status, "confirmed")));
    if (!facts.length) return { scanned: 0 };
    const recent = await db
      .select()
      .from(responses)
      .where(and(eq(responses.websiteId, websiteId), gte(responses.ranAt, new Date(Date.now() - 7 * 86400_000))))
      .orderBy(desc(responses.ranAt))
      .limit(500);

    let findings = 0;
    for (const fact of facts) {
      // naive contradiction heuristic: numeric claim present but with a different number in responses
      const nums = fact.claim.match(/\d[\d,.]*/g);
      if (!nums?.length) continue;
      for (const resp of recent) {
        for (const n of nums) {
          const other = resp.rawText.match(/\d[\d,.]*/g)?.filter((x) => x !== n) ?? [];
          if (resp.rawText.toLowerCase().includes(fact.claim.split(" ").slice(0, 3).join(" ").toLowerCase()) && other.length) {
            const dup = await db
              .select({ id: oracleFindings.id })
              .from(oracleFindings)
              .where(and(eq(oracleFindings.responseId, resp.id), eq(oracleFindings.factId, fact.id)));
            if (!dup.length) {
              await db.insert(oracleFindings).values({
                websiteId,
                responseId: resp.id,
                factId: fact.id,
                type: "confirmed_inaccuracy",
                claim: fact.claim,
                evidence: resp.rawText.slice(0, 400),
                models: [resp.model],
              });
              findings++;
            }
            break;
          }
        }
      }
    }
    return { scanned: recent.length, findings };
  },
);

/** Weekly report sending (Slack + email recipients). */
export const weeklyReports = inngest.createFunction(
  { id: "reports-weekly" },
  { cron: "TZ=UTC 9H * * 1" },
  async () => {
    const reports = await db.select().from(scheduledReports).where(eq(scheduledReports.cadence, "weekly"));
    let sent = 0;
    for (const r of reports) {
      await db.update(scheduledReports).set({ lastSentAt: new Date() }).where(eq(scheduledReports.id, r.id));
      sent++;
      // delivery adapters (Slack/email) live in apps/web; job marks the cadence tick
    }
    return { sent };
  },
);

export const functions = [
  collectFn,
  reaggregateFn,
  nightlyCollections,
  generateInsights,
  oracleScan,
  weeklyReports,
];
