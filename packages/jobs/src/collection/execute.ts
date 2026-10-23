/** Execute a run's pending items: ask each AI model, extract, persist; refund failures once. */
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  type Db,
  runs,
  runItems,
  prompts,
  locations,
  websites,
  competitors,
  attributes,
  responses,
  responseMentions,
  responseCitations,
  attributeObservations,
} from "@athena/db";
import { extract } from "@athena/core/extract";
import { citationRow } from "@athena/core/sources";
import { refundCredits } from "@athena/core/billing";
import { generateInsights } from "@athena/core/insights";
import { runOracleScan } from "@athena/core/knowledge";
import { discoverOutreachForSite } from "@athena/core/outreach";
import { syncShoppingProductsForSite, captureSponsoredAdsForSite } from "@athena/core/commerce";
import type { SearchAdapter, CollectedAnswer } from "@athena/llm/providers";

/** Upper bound on stored answer text (providers occasionally return huge payloads). */
export const MAX_ANSWER_CHARS = 100_000;

export interface ExecuteOptions {
  adapters: SearchAdapter[];
  /** items processed concurrently */
  concurrency?: number;
  /** stop after this many items (for chunked/serverless execution) */
  maxItems?: number;
}

type ItemRow = typeof runItems.$inferSelect;

/** Items stuck in "running" (worker crashed) go back to pending. */
export async function requeueStale(db: Db, runId: string, olderThanMs = 15 * 60_000): Promise<number> {
  const rows = await db
    .update(runItems)
    .set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(runItems.runId, runId), eq(runItems.status, "running"), lt(runItems.updatedAt, new Date(Date.now() - olderThanMs))))
    .returning({ id: runItems.id });
  return rows.length;
}

async function claim(db: Db, runId: string, n: number): Promise<ItemRow[]> {
  const ids = db
    .select({ id: runItems.id })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.status, "pending")))
    .limit(n)
    .for("update", { skipLocked: true });
  return db
    .update(runItems)
    .set({ status: "running", attempts: sql`${runItems.attempts} + 1`, updatedAt: new Date() })
    .where(inArray(runItems.id, ids))
    .returning();
}

function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 300);
}

interface RunContext {
  run: typeof runs.$inferSelect;
  site: typeof websites.$inferSelect;
  comps: (typeof competitors.$inferSelect)[];
  attrs: (typeof attributes.$inferSelect)[];
}

async function persist(db: Db, ctx: RunContext, item: ItemRow, answer: CollectedAnswer): Promise<void> {
  const ex = extract({
    rawText: answer.text.slice(0, MAX_ANSWER_CHARS),
    brandName: ctx.site.name,
    brandDomain: ctx.site.domain,
    competitors: ctx.comps.map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
    attributes: ctx.attrs.map((a) => a.name),
  });
  // provider-reported sources first (in order), then links found in the text
  const seen = new Set<string>();
  const citations = [...answer.citations.map((c) => ({ url: c.url, domain: c.domain })), ...ex.citations.map((c) => ({ url: c.url, domain: undefined }))]
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .map((c, rank) => ({ ...citationRow(c.url, ctx.site.domain, c.domain), rank }));

  await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(responses)
      .values({
        runId: ctx.run.id,
        promptId: item.promptId,
        websiteId: ctx.site.id,
        model: item.model,
        provider: answer.provider,
        simulated: answer.simulated ?? false,
        rawText: answer.text.slice(0, MAX_ANSWER_CHARS),
        mentioned: ex.mentioned,
        cited: citations.some((c) => c.isBrand),
        position: ex.position,
        sentiment: ex.sentiment,
        shoppingCard: ex.shoppingCard,
        tokensIn: answer.tokensIn,
        tokensOut: answer.tokensOut,
      })
      .returning({ id: responses.id });
    if (ex.mentions.length) {
      await tx.insert(responseMentions).values(
        ex.mentions.map((m) => ({ responseId: saved.id, competitorId: m.competitorId, name: m.name, sentiment: m.sentiment, position: m.position })),
      );
    }
    if (citations.length) {
      await tx.insert(responseCitations).values(citations.map((c) => ({ responseId: saved.id, ...c })));
    }
    const attrIds = new Map(ctx.attrs.map((a) => [a.name, a.id]));
    const obs = ex.observations.filter((o) => attrIds.has(o.attribute));
    if (obs.length) {
      await tx.insert(attributeObservations).values(
        obs.map((o) => ({
          attributeId: attrIds.get(o.attribute)!,
          responseId: saved.id,
          competitorId: o.competitorId,
          textSpan: o.textSpan,
          score: o.score.toFixed(2),
          positive: o.positive,
        })),
      );
    }
    await tx.update(runItems).set({ status: "succeeded", responseId: saved.id, error: null, updatedAt: new Date() }).where(eq(runItems.id, item.id));
    await tx.update(runs).set({ completedResponses: sql`${runs.completedResponses} + 1` }).where(eq(runs.id, ctx.run.id));
  });
}

async function fail(db: Db, ctx: RunContext, item: ItemRow, err: unknown): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(runItems).set({ status: "failed", error: safeError(err), updatedAt: new Date() }).where(eq(runItems.id, item.id));
    await tx
      .update(runs)
      .set({ completedResponses: sql`${runs.completedResponses} + 1`, failedResponses: sql`${runs.failedResponses} + 1` })
      .where(eq(runs.id, ctx.run.id));
  });
}

/** Close the run when no work remains; refund failed items exactly once. */
export async function finalizeRun(db: Db, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
    if (!run || run.state === "completed" || run.state === "failed" || run.state === "cancelled") return;
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(runItems)
      .where(and(eq(runItems.runId, runId), inArray(runItems.status, ["pending", "running"])));
    if ((open?.n ?? 0) > 0) return;
    const [counts] = await tx
      .select({
        failed: sql<number>`count(*) filter (where ${runItems.status} = 'failed')::int`,
        succeeded: sql<number>`count(*) filter (where ${runItems.status} = 'succeeded')::int`,
      })
      .from(runItems)
      .where(eq(runItems.runId, runId));
    const failed = counts?.failed ?? 0;
    const [site] = await tx.select({ organizationId: websites.organizationId }).from(websites).where(eq(websites.id, run.websiteId));
    if (failed > 0 && site) {
      await refundCredits(tx, { organizationId: site.organizationId, websiteId: run.websiteId, amount: failed, runId, reason: `Refund for ${failed} failed responses` });
    }
    await tx
      .update(runs)
      .set({ state: (counts?.succeeded ?? 0) > 0 ? "completed" : "failed", finishedAt: new Date(), creditsRefunded: failed })
      .where(eq(runs.id, runId));
  });
}

export async function executeRun(db: Db, runId: string, opts: ExecuteOptions): Promise<{ processed: number; done: boolean }> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run || run.state === "completed" || run.state === "failed" || run.state === "cancelled") return { processed: 0, done: true };
  const [site] = await db.select().from(websites).where(eq(websites.id, run.websiteId));
  if (!site) return { processed: 0, done: true };
  if (run.state === "queued") await db.update(runs).set({ state: "running", startedAt: new Date() }).where(eq(runs.id, runId));
  await requeueStale(db, runId);
  const ctx: RunContext = {
    run,
    site,
    comps: await db.select().from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt))),
    attrs: await db.select().from(attributes).where(eq(attributes.websiteId, site.id)),
  };
  const byModel = new Map(opts.adapters.map((a) => [a.model as string, a]));
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const budget = opts.maxItems ?? Number.POSITIVE_INFINITY;
  let processed = 0;
  while (processed < budget) {
    const batch = await claim(db, runId, Math.min(concurrency, budget - processed));
    if (!batch.length) break;
    const promptRows = await db
      .select({ id: prompts.id, text: prompts.text, country: locations.country })
      .from(prompts)
      .leftJoin(locations, and(eq(locations.id, prompts.locationId), isNull(locations.deletedAt)))
      .where(inArray(prompts.id, batch.map((b) => b.promptId)));
    const promptById = new Map(promptRows.map((p) => [p.id, p]));
    await Promise.all(
      batch.map(async (item) => {
        const adapter = byModel.get(item.model);
        const prompt = promptById.get(item.promptId);
        try {
          if (!adapter) throw new Error(`model ${item.model} is no longer configured`);
          if (!prompt) throw new Error("prompt no longer exists");
          const answer = await adapter.collect(prompt.text, { country: prompt.country ?? site.country, entities: [site.name, ...ctx.comps.map((c) => c.name)] });
          await persist(db, ctx, item, answer);
        } catch (err) {
          await fail(db, ctx, item, err);
        }
      }),
    );
    processed += batch.length;
  }
  await finalizeRun(db, runId);
  const [after] = await db.select({ state: runs.state }).from(runs).where(eq(runs.id, runId));
  const done = after?.state !== "running";
  if (done && after?.state === "completed" && processed > 0) await refreshDerivedData(db, site);
  return { processed, done };
}

/** Recomputes data derived from answers after a run; each step runs (and fails) on its own. */
async function refreshDerivedData(db: Db, site: typeof websites.$inferSelect): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["insights", () => generateInsights(db, { websiteId: site.id })],
    ["oracle", () => runOracleScan(db, { websiteId: site.id })],
    ["outreach", () => discoverOutreachForSite(db, site)],
    ["shopping", () => syncShoppingProductsForSite(db, site)],
    ["ads", () => captureSponsoredAdsForSite(db, site)],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (err) {
      console.warn(`[post-run] ${name} refresh failed`, site.id, err instanceof Error ? err.message : err);
    }
  }
}

export interface RunProgress {
  id: string;
  state: string;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  percent: number;
  creditsReserved: number;
  creditsRefunded: number;
  models: string[];
  createdAt: Date;
  finishedAt: Date | null;
}

export async function getRunProgress(db: Db, runId: string): Promise<RunProgress> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error("run not found");
  const [c] = await db
    .select({
      succeeded: sql<number>`count(*) filter (where ${runItems.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${runItems.status} = 'failed')::int`,
      open: sql<number>`count(*) filter (where ${runItems.status} in ('pending','running'))::int`,
    })
    .from(runItems)
    .where(eq(runItems.runId, runId));
  const total = run.totalResponses;
  const finished = (c?.succeeded ?? 0) + (c?.failed ?? 0);
  return {
    id: run.id,
    state: run.state,
    total,
    succeeded: c?.succeeded ?? 0,
    failed: c?.failed ?? 0,
    pending: c?.open ?? 0,
    percent: total ? Math.round((finished / total) * 100) : 100,
    creditsReserved: run.creditsReserved,
    creditsRefunded: run.creditsRefunded,
    models: run.models,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}

/** Runs with work left but no item activity for `idleMs` (crashed worker / cut-off serverless function). */
export async function stalledRuns(db: Db, idleMs = 15 * 60_000, now = new Date()): Promise<{ id: string }[]> {
  const cutoff = new Date(now.getTime() - idleMs);
  return db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        inArray(runs.state, ["queued", "running"]),
        sql`exists (select 1 from run_items i where i.run_id = "runs"."id" and i.status in ('pending','running'))`,
        sql`coalesce((select max(i.updated_at) from run_items i where i.run_id = "runs"."id"), "runs"."created_at") < ${cutoff}`,
      ),
    );
}
