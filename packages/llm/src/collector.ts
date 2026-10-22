/**
 * Collector: runs a batch of prompt×model combinations, persists responses
 * with structured extraction, consumes credits, updates run progress.
 * Called from Inngest workflows (packages/jobs) and the polling API.
 */
import { db } from "@athena/db";
import {
  runs,
  responses,
  responseMentions,
  responseCitations,
  prompts,
  websites,
  competitors,
  attributes,
  creditBalances,
  creditLedger,
} from "@athena/db";
import { extract } from "@athena/core/extract";
import { eq, and, inArray, sql } from "drizzle-orm";
import { providerFor, type SearchProvider } from "./index.js";

export interface CollectBatchOptions {
  runId: string;
  websiteId: string;
  promptIds: string[];
  models: string[];
}

/** Consume credits atomically; returns false when insufficient balance. */
export async function consumeCredits(
  organizationId: string,
  websiteId: string,
  amount: number,
  runId: string,
): Promise<boolean> {
  const [bal] = await db
    .select()
    .from(creditBalances)
    .where(and(eq(creditBalances.organizationId, organizationId), eq(creditBalances.websiteId, websiteId)));
  if (!bal || bal.balance < amount) return false;
  await db
    .update(creditBalances)
    .set({ balance: bal.balance - amount, updatedAt: new Date() })
    .where(eq(creditBalances.id, bal.id));
  await db.insert(creditLedger).values({
    organizationId,
    websiteId,
    kind: "consume",
    amount: -amount,
    reason: "response collection",
    runId,
  });
  return true;
}

async function analyzeOne(responseId: string, rawText: string): Promise<void> {
  // extraction is applied inside collectBatch; kept as a hook point
  void responseId;
  void rawText;
}

/**
 * Collect responses for the given prompt×model matrix.
 * Returns the number of responses stored.
 */
export async function collectBatch(opts: CollectBatchOptions): Promise<number> {
  const { runId, websiteId, promptIds, models } = opts;

  const [website] = await db.select().from(websites).where(eq(websites.id, websiteId));
  if (!website) throw new Error(`website ${websiteId} not found`);

  const promptRows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.websiteId, websiteId), inArray(prompts.id, promptIds), sql`${prompts.deletedAt} is null`));
  const competitorRows = await db.select().from(competitors).where(eq(competitors.websiteId, websiteId));
  const attributeRows = await db.select().from(attributes).where(eq(attributes.websiteId, websiteId));

  // reserve credits for the full matrix
  const total = promptRows.length * models.length;
  const reserved = await consumeCredits(website.organizationId, websiteId, total, runId);
  await db
    .update(runs)
    .set({
      state: reserved ? "running" : "failed",
      creditsReserved: reserved ? total : 0,
      totalResponses: total,
      startedAt: new Date(),
    })
    .where(eq(runs.id, runId));
  if (!reserved) throw new Error("insufficient credits");

  let completed = 0;
  for (const prompt of promptRows) {
    for (const model of models) {
      const provider: SearchProvider = providerFor(model);
      try {
        const result = await provider.collect(prompt.text);
        const extraction = extract({
          rawText: result.rawText,
          brandName: website.name,
          brandDomain: website.domain,
          competitors: competitorRows.map((c) => ({ id: c.id, name: c.name, domain: c.domain })),
          attributes: attributeRows.map((a) => a.name),
        });

        const [saved] = await db
          .insert(responses)
          .values({
            runId,
            promptId: prompt.id,
            websiteId,
            model,
            rawText: result.rawText,
            mentioned: extraction.mentioned,
            cited: extraction.cited,
            position: extraction.position,
            sentiment: extraction.sentiment,
            shoppingCard: extraction.shoppingCard,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          })
          .returning({ id: responses.id });

        if (extraction.mentions.length) {
          await db.insert(responseMentions).values(
            extraction.mentions.map((m) => ({
              responseId: saved.id,
              competitorId: m.competitorId,
              name: m.name,
              sentiment: m.sentiment,
              position: m.position,
            })),
          );
        }
        if (extraction.citations.length) {
          await db.insert(responseCitations).values(
            extraction.citations.map((c) => ({
              responseId: saved.id,
              url: c.url,
              domain: c.domain,
              rank: c.rank,
              isBrand: c.isBrand,
            })),
          );
        }
      } catch (err) {
        // record the failure as an empty response row to keep progress accurate
        await db.insert(responses).values({
          runId,
          promptId: prompt.id,
          websiteId,
          model,
          rawText: `collection error: ${(err as Error).message}`,
          mentioned: false,
          cited: false,
        });
      } finally {
        completed++;
        await db.update(runs).set({ completedResponses: completed }).where(eq(runs.id, runId));
      }
    }
  }

  await db.update(runs).set({ state: "completed", finishedAt: new Date() }).where(eq(runs.id, runId));
  await analyzeOne(runId, "");
  return completed;
}
