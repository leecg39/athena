/**
 * Inngest workflows: chunked, durable execution of collection runs and the
 * schedule dispatcher. Served by apps/web at /api/inngest.
 */
import { getDb } from "@athena/db";
import { generateInsightsForSite } from "@athena/core/insights";
import { configuredAdapters } from "@athena/llm/providers";
import { inngest } from "./inngest";
import { executeRun, planRun, dueSchedules, stalledRuns, reanalyzeResponses, generateAllInsights } from "./collection";

export { inngest };
export * from "./collection";

/** Items per durable step (keeps each step well inside serverless time limits). */
const ITEMS_PER_STEP = 10;

export const executeRunFn = inngest.createFunction(
  { id: "run-execute", retries: 3, concurrency: { key: "event.data.runId", limit: 1 } },
  { event: "run/execute" },
  async ({ event, step }) => {
    const runId = (event.data as { runId: string }).runId;
    for (let i = 0; i < 2000; i++) {
      const r = await step.run(`batch-${i}`, () => executeRun(getDb(), runId, { adapters: configuredAdapters(), maxItems: ITEMS_PER_STEP }));
      if (r.done) return { batches: i + 1 };
    }
    return { batches: 2000 };
  },
);

/** Start every schedule whose cadence elapsed; failures (e.g. no credits) are logged, not retried. */
export async function dispatchDueSchedules(dispatch: (runId: string) => Promise<void>): Promise<{ started: number; skipped: number; resumed: number }> {
  const db = getDb();
  const adapters = configuredAdapters();
  let started = 0;
  let skipped = 0;
  let resumed = 0;
  // runs whose worker died (e.g. a cut-off serverless function) are picked up again
  for (const r of await stalledRuns(db)) {
    await dispatch(r.id);
    resumed++;
  }
  for (const s of await dueSchedules(db)) {
    try {
      const run = await planRun(db, { websiteId: s.websiteId, scheduleId: s.id, trigger: "schedule", adapters });
      await dispatch(run.id);
      started++;
    } catch (err) {
      skipped++;
      console.warn("[schedule] not started", s.id, err instanceof Error ? err.message : err);
    }
  }
  return { started, skipped, resumed };
}

export const dispatchSchedulesFn = inngest.createFunction(
  { id: "schedules-dispatch" },
  { cron: "TZ=UTC */30 * * * *" },
  async ({ step }) =>
    step.run("dispatch", () =>
      dispatchDueSchedules(async (runId) => {
        await inngest.send({ name: "run/execute", data: { runId } });
      }),
    ),
);

/** Recompute mentions/positions after competitors change (debounced per website). */
export const reanalyzeFn = inngest.createFunction(
  { id: "website-reanalyze", debounce: { key: "event.data.websiteId", period: "30s" } },
  { event: "website/reanalyze" },
  async ({ event, step }) =>
    step.run("reanalyze", () => reanalyzeResponses(getDb(), { websiteId: (event.data as { websiteId: string }).websiteId })),
);

/** Periodic 6-hour AI insights evaluation across all active websites. */
export const generateInsightsCronFn = inngest.createFunction(
  { id: "insights-generate-cron" },
  { cron: "TZ=UTC 0 */6 * * *" },
  async ({ step }) => step.run("generate-all-insights", () => generateAllInsights(getDb())),
);

/** On-demand / event-driven AI insights refresh for one website. */
export const generateWebsiteInsightsFn = inngest.createFunction(
  { id: "website-insights-generate", debounce: { key: "event.data.websiteId", period: "15s" } },
  { event: "website/insights.generate" },
  async ({ event, step }) =>
    step.run("generate-website-insights", () =>
      generateInsightsForSite(getDb(), { websiteId: (event.data as { websiteId: string }).websiteId }),
    ),
);

export const functions = [executeRunFn, dispatchSchedulesFn, reanalyzeFn, generateInsightsCronFn, generateWebsiteInsightsFn];
