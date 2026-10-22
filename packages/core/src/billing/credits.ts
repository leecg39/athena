/** Organization credit balance + ledger. 1 credit = 1 collected AI response. */
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { type Db, creditBalances, creditLedger } from "@athena/db";
import type { DbOrTx } from "../prompts/shared";

const orgBalance = (organizationId: string) =>
  and(eq(creditBalances.organizationId, organizationId), isNull(creditBalances.websiteId), isNull(creditBalances.groupId));

export async function getOrgBalance(db: DbOrTx, organizationId: string): Promise<number> {
  const [row] = await db.select({ balance: creditBalances.balance }).from(creditBalances).where(orgBalance(organizationId));
  return row?.balance ?? 0;
}

/**
 * Atomically take `amount` credits if (and only if) the balance covers it.
 * A single conditional UPDATE makes concurrent reservations safe.
 */
export async function reserveCredits(
  db: DbOrTx,
  input: { organizationId: string; websiteId?: string | null; amount: number; runId?: string | null; reason: string },
): Promise<boolean> {
  if (input.amount <= 0) return true;
  const updated = await db
    .update(creditBalances)
    .set({ balance: sql`${creditBalances.balance} - ${input.amount}`, updatedAt: new Date() })
    .where(and(orgBalance(input.organizationId), gte(creditBalances.balance, input.amount)))
    .returning({ balance: creditBalances.balance });
  if (!updated.length) return false;
  await db.insert(creditLedger).values({
    organizationId: input.organizationId,
    websiteId: input.websiteId ?? null,
    kind: "consume",
    amount: -input.amount,
    reason: input.reason,
    runId: input.runId ?? null,
  });
  return true;
}

export async function refundCredits(
  db: DbOrTx,
  input: { organizationId: string; websiteId?: string | null; amount: number; runId?: string | null; reason: string },
): Promise<void> {
  if (input.amount <= 0) return;
  await db
    .update(creditBalances)
    .set({ balance: sql`${creditBalances.balance} + ${input.amount}`, updatedAt: new Date() })
    .where(orgBalance(input.organizationId));
  await db.insert(creditLedger).values({
    organizationId: input.organizationId,
    websiteId: input.websiteId ?? null,
    kind: "refund",
    amount: input.amount,
    reason: input.reason,
    runId: input.runId ?? null,
  });
}

export type { Db };
