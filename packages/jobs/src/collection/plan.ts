/** Plan a collection run: pick prompts × models, reserve credits atomically, create work items. */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { type Db, runs, runItems, prompts, organizations, websites } from "@athena/db";
import { PLANS } from "@athena/core";
import { requireWebsitePermission } from "@athena/core/tenancy";
import { reserveCredits, getOrgBalance } from "@athena/core/billing";
import { lockWebsite } from "@athena/core/prompts";
import { DomainError, NotFoundError, logActivity } from "@athena/core/org";
import type { SearchAdapter } from "@athena/llm/providers";

export type RunTrigger = "manual" | "schedule" | "api";

export interface PlanRunInput {
  websiteId: string;
  trigger: RunTrigger;
  adapters: SearchAdapter[];
  /** required for manual/api runs (permission check); omitted for scheduled runs */
  actorId?: string;
  scheduleId?: string | null;
  promptIds?: string[];
  models?: string[];
}

export type RunRow = typeof runs.$inferSelect;

const ACTIVE_STATES = ["queued", "running"] as const;

export async function planRun(db: Db, input: PlanRunInput): Promise<RunRow> {
  const site = input.actorId
    ? await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:write")
    : (await db.select().from(websites).where(and(eq(websites.id, input.websiteId), isNull(websites.deletedAt))))[0];
  if (!site) throw new NotFoundError("Website not found");

  const [org] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, site.organizationId));
  const planModels = new Set<string>(PLANS[org?.plan ?? "free"].models);
  const models = input.adapters
    .map((a) => a.model as string)
    .filter((m) => m === "simulated" || planModels.has(m))
    .filter((m) => !input.models || input.models.includes(m));
  if (!models.length) throw new DomainError("No AI models are available for collection on this plan. Configure a provider API key.");

  return db.transaction(async (tx) => {
    // one active run per website at a time
    await lockWebsite(tx, site.id);
    const [active] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.websiteId, site.id), inArray(runs.state, [...ACTIVE_STATES])));
    if (active) throw new DomainError("A collection run is already in progress for this website");

    const conds = [eq(prompts.websiteId, site.id), eq(prompts.status, "active"), isNull(prompts.deletedAt)];
    if (input.scheduleId) conds.push(eq(prompts.scheduleId, input.scheduleId));
    if (input.promptIds?.length) conds.push(inArray(prompts.id, input.promptIds));
    const promptRows = await tx.select({ id: prompts.id }).from(prompts).where(and(...conds));
    if (!promptRows.length) throw new DomainError("There are no active prompts to collect");

    const total = promptRows.length * models.length;
    const [run] = await tx
      .insert(runs)
      .values({
        websiteId: site.id,
        scheduleId: input.scheduleId ?? null,
        trigger: input.trigger,
        requestedBy: input.actorId ?? null,
        models,
        state: "queued",
        totalResponses: total,
        creditsReserved: total,
      })
      .returning();
    const ok = await reserveCredits(tx, { organizationId: site.organizationId, websiteId: site.id, amount: total, runId: run.id, reason: `Collection run (${promptRows.length} prompts × ${models.length} models)` });
    if (!ok) {
      const have = await getOrgBalance(tx, site.organizationId);
      throw new DomainError(`Not enough credits: this run needs ${total}, you have ${have}`); // rolls back the run
    }
    await tx.insert(runItems).values(promptRows.flatMap((p) => models.map((model) => ({ runId: run.id, promptId: p.id, model }))));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId ?? null,
      websiteId: site.id,
      entityType: "run",
      entityId: run.id,
      change: "started",
      after: { trigger: input.trigger, prompts: promptRows.length, models, credits: total },
    });
    return run;
  });
}
