/**
 * Local demo data through the REAL pipeline (services → collection engine)
 * using the dev-only simulated provider. Every response is stored with
 * `simulated = true`. Idempotent: re-running adds nothing for existing days.
 *
 *   DATABASE_URL=… npm run seed -w @athena/jobs
 */
import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, closeDb, websites, runs, responses, competitors, creditBalances, creditLedger } from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "@athena/core/tenancy";
import { addTrackedPrompts, saveMonitoringSchedule } from "@athena/core/onboarding";
import { SimulatedAdapter } from "@athena/llm/providers";
import { planRun, executeRun } from "../src/collection";

if (process.env.NODE_ENV === "production") throw new Error("seed-demo must not run in production");

const DAYS = 14;
const db = getDb();

async function main() {
  const { user, organizationId } = await ensureUserWithOrg(db, { email: process.env.SEED_EMAIL ?? "demo@example.com", name: "Demo User" });
  let [site] = await db
    .select()
    .from(websites)
    .where(and(eq(websites.organizationId, organizationId), eq(websites.domain, "canvasly.io"), isNull(websites.deletedAt)));
  if (!site) {
    site = await createWebsite(db, { organizationId, userId: user.id, domain: "canvasly.io", name: "Canvasly" });
    await db.update(websites).set({ onboardedAt: new Date(), onboardingStep: 7, profile: { description: "AI design canvas for product teams", products: ["Design canvas", "Design tokens"] } }).where(eq(websites.id, site.id));
    await db.insert(competitors).values([
      { websiteId: site.id, name: "Figma", domain: "figma.com" },
      { websiteId: site.id, name: "Canva", domain: "canva.com" },
      { websiteId: site.id, name: "Adobe Express", domain: "adobe.com" },
    ]).onConflictDoNothing();
    await saveMonitoringSchedule(db, { actorId: user.id, websiteId: site.id, cadence: "daily" });
    await addTrackedPrompts(db, {
      actorId: user.id,
      websiteId: site.id,
      topics: [
        { name: "Design tools", prompts: ["best ai design tools for product teams", "what is the best collaborative design canvas", "canvasly vs figma for prototyping"] },
        { name: "Design systems", prompts: ["how to automate design tokens", "best tools for maintaining a design system"] },
        { name: "Alternatives", prompts: ["best alternatives to figma", "is canva good for product design"] },
      ],
    });
  }
  const [{ n: existingRuns }] = await db.select({ n: sql<number>`count(*)::int` }).from(runs).where(eq(runs.websiteId, site.id));
  for (let day = DAYS - 1 - existingRuns; day >= 0; day--) {
    const when = new Date(Date.now() - day * 86_400_000);
    // top up so the demo never blocks on credits (recorded in the ledger as a seed grant)
    await db.update(creditBalances).set({ balance: sql`${creditBalances.balance} + 100` }).where(and(eq(creditBalances.organizationId, organizationId), isNull(creditBalances.websiteId), isNull(creditBalances.groupId)));
    await db.insert(creditLedger).values({ organizationId, kind: "grant", amount: 100, reason: "Demo seed top-up" });
    const adapters = [new SimulatedAdapter(() => when)];
    const run = await planRun(db, { websiteId: site.id, trigger: "schedule", adapters });
    await executeRun(db, run.id, { adapters });
    await db.update(runs).set({ createdAt: when, startedAt: when, finishedAt: when }).where(eq(runs.id, run.id));
    await db.update(responses).set({ ranAt: when, createdAt: when }).where(eq(responses.runId, run.id));
    process.stdout.write(`seeded ${when.toISOString().slice(0, 10)}\n`);
  }
  process.stdout.write(`demo ready: ${user.email} / ${site.domain}\n`);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    process.stderr.write(`seed failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    await closeDb();
    process.exit(1);
  });
