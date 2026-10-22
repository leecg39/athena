/**
 * Inngest workflows: chunked, durable execution of collection runs and the
 * schedule dispatcher. Served by apps/web at /api/inngest.
 */
import { getDb } from "@athena/db";
import { configuredAdapters } from "@athena/llm/providers";
import { inngest } from "./inngest";
import { executeRun, planRun, dueSchedules, stalledRuns } from "./collection";

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

export const functions = [executeRunFn, dispatchSchedulesFn];
