/** Moving credits between the organization pool and a website pool (no credits are created). */
import { z } from "zod";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { type Db, creditBalances, creditLedger, websites } from "@athena/db";
import { requirePermission } from "../org/access";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";

const allocateWebsiteCreditsSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  websiteId: z.string().uuid(),
  amount: z.number().int().min(1, "Amount must be at least 1 credit").max(1_000_000),
  direction: z.enum(["to_website", "to_org"]),
  reason: z.string().trim().max(240).optional(),
});

/**
 * Atomically allocates credits between the Organization Unallocated Pool and a specific
 * Website Dedicated Credit Pool (`credit_balances.website_id`), recording paired ledger rows.
 */
export async function allocateWebsiteCredits(
  db: Db,
  rawInput: z.input<typeof allocateWebsiteCreditsSchema>,
): Promise<{ orgBalance: number; websiteBalance: number }> {
  const parsed = allocateWebsiteCreditsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid website credit allocation");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "billing:write");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"billing:" + input.organizationId}))`,
    );

    const [site] = await tx
      .select()
      .from(websites)
      .where(
        and(
          eq(websites.id, input.websiteId),
          eq(websites.organizationId, input.organizationId),
          isNull(websites.deletedAt),
        ),
      );
    if (!site) throw new NotFoundError("Website not found");

    const [existingSiteBal] = await tx
      .select()
      .from(creditBalances)
      .where(
        and(
          eq(creditBalances.organizationId, input.organizationId),
          eq(creditBalances.websiteId, site.id),
          isNull(creditBalances.groupId),
        ),
      );

    let siteBalId = existingSiteBal?.id;
    if (!siteBalId) {
      const [inserted] = await tx
        .insert(creditBalances)
        .values({
          organizationId: input.organizationId,
          websiteId: site.id,
          groupId: null,
          balance: 0,
        })
        .returning({ id: creditBalances.id });
      siteBalId = inserted!.id;
    }

    if (input.direction === "to_website") {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
            gte(creditBalances.balance, input.amount),
          ),
        )
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient organization unallocated credits");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.id, siteBalId))
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Dedicated credit allocation to website "${site.name}"`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "adjustment",
          amount: -input.amount,
          reason: `Allocated to website: ${site.name}`,
        },
        {
          organizationId: input.organizationId,
          websiteId: site.id,
          groupId: null,
          kind: "grant",
          amount: input.amount,
          reason: note,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        websiteId: site.id,
        userId: input.actorId,
        entityType: "website_credits",
        entityId: site.id,
        change: "allocated_to_website",
        after: { amount: input.amount, websiteBalance: credited[0]!.balance },
      });

      return {
        orgBalance: deducted[0]!.balance,
        websiteBalance: credited[0]!.balance,
      };
    } else {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(and(eq(creditBalances.id, siteBalId), gte(creditBalances.balance, input.amount)))
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient website dedicated credits to return to organization");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
          ),
        )
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Returned website credits from "${site.name}" to org pool`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: site.id,
          groupId: null,
          kind: "adjustment",
          amount: -input.amount,
          reason: note,
        },
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "grant",
          amount: input.amount,
          reason: `Returned from website: ${site.name}`,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        websiteId: site.id,
        userId: input.actorId,
        entityType: "website_credits",
        entityId: site.id,
        change: "returned_to_org",
        after: { amount: input.amount, websiteBalance: deducted[0]!.balance },
      });

      return {
        orgBalance: credited[0]?.balance ?? 0,
        websiteBalance: deducted[0]!.balance,
      };
    }
  });
}
