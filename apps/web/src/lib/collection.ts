import "server-only";
import { after } from "next/server";
import { db } from "@athena/db";
import { executeRun, reanalyzeResponses } from "@athena/jobs/collection";
import { configuredAdapters } from "@athena/llm/providers";

/** Inngest is used when configured; otherwise runs execute in-process after the response. */
export function inngestEnabled(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY) || process.env.INNGEST_DEV === "1";
}

export async function dispatchRun(runId: string): Promise<void> {
  if (inngestEnabled()) {
    const { inngest } = await import("@athena/jobs");
    await inngest.send({ name: "run/execute", data: { runId } });
    return;
  }
  after(async () => {
    try {
      await executeRun(db, runId, { adapters: configuredAdapters() });
    } catch (err) {
      console.error("[collection] inline run failed", runId, err);
    }
  });
}

/**
 * Re-extract stored answers in the background (after competitor changes). The
 * change is already committed, so a queueing failure falls back to running
 * in-process instead of reporting the change as failed.
 */
export async function scheduleReanalysis(websiteId: string): Promise<void> {
  if (inngestEnabled()) {
    try {
      const { inngest } = await import("@athena/jobs");
      await inngest.send({ name: "website/reanalyze", data: { websiteId } });
      return;
    } catch (err) {
      console.error("[reanalyze] could not queue; running in-process", websiteId, err);
    }
  }
  after(async () => {
    try {
      await reanalyzeResponses(db, { websiteId });
    } catch (err) {
      console.error("[reanalyze] failed", websiteId, err);
    }
  });
}
