/** Cancel a run: stop pending work and refund every unprocessed item. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Db, runs, runItems } from "@athena/db";
import { requireWebsitePermission } from "@athena/core/tenancy";
import { refundCredits } from "@athena/core/billing";
import { logActivity } from "@athena/core/org";
import { DomainError, NotFoundError } from "@athena/core/org";

export async function cancelRun(db: Db, input: { actorId: string; runId: string }): Promise<void> {
  const [run] = await db.select().from(runs).where(eq(runs.id, input.runId));
  if (!run) throw new NotFoundError("Run not found");
  const site = await requireWebsitePermission(db, input.actorId, run.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(runs).where(eq(runs.id, run.id)).for("update");
    if (!locked || !["queued", "running"].includes(locked.state)) throw new DomainError("Only queued or running collections can be cancelled");
    const stopped = await tx
      .update(runItems)
      .set({ status: "failed", error: "cancelled", updatedAt: new Date() })
      .where(and(eq(runItems.runId, run.id), inArray(runItems.status, ["pending", "running"])))
      .returning({ id: runItems.id });
    const [failed] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(runItems)
      .where(and(eq(runItems.runId, run.id), eq(runItems.status, "failed")));
    const refund = failed?.n ?? 0;
    await refundCredits(tx, { organizationId: site.organizationId, websiteId: site.id, amount: refund, runId: run.id, reason: `Refund for cancelled collection (${refund} answers)` });
    await tx
      .update(runs)
      .set({ state: "cancelled", finishedAt: new Date(), creditsRefunded: refund, failedResponses: refund, completedResponses: sql`${runs.totalResponses}` })
      .where(eq(runs.id, run.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "run", entityId: run.id, change: "cancelled", after: { stopped: stopped.length, refunded: refund } });
  });
}
