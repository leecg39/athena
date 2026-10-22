import "server-only";
import { after } from "next/server";
import { db } from "@athena/db";
import { executeRun } from "@athena/jobs/collection";
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
