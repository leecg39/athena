import { and, eq, isNull, sql } from "drizzle-orm";
import { db, prompts, organizations, promptSchedules } from "@athena/db";
import { PLANS } from "@athena/core";
import type { WebsiteRow } from "@athena/core/tenancy";
import { ActionForm } from "@/components/action-form";
import { finishOnboarding } from "../actions";

const OPTIONS = [
  { value: "daily", label: "Daily", runsPerMonth: 30 },
  { value: "every_3_days", label: "Every 3 days", runsPerMonth: 10 },
  { value: "weekly", label: "Weekly", runsPerMonth: 4 },
] as const;

export async function ScheduleStep({ site }: { site: WebsiteRow }) {
  const [[count], [org], [schedule]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(prompts).where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt))),
    db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, site.organizationId)),
    db.select().from(promptSchedules).where(and(eq(promptSchedules.websiteId, site.id), eq(promptSchedules.kind, "default"))),
  ]);
  const plan = PLANS[org?.plan ?? "free"];
  const perRun = (count?.n ?? 0) * plan.models.length;
  const budget = plan.monthlyCredits; // 0 = custom (enterprise)
  const fits = (runs: number) => !budget || perRun * runs <= budget;
  const fallback = OPTIONS.find((o) => fits(o.runsPerMonth))?.value ?? "weekly";
  const selected = schedule?.cadence ?? fallback;
  return (
    <ActionForm action={finishOnboarding} submitLabel="Finish setup" className="space-y-4">
      <input type="hidden" name="websiteId" value={site.id} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-gray-600">How often should we ask AI models your prompts?</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center justify-between rounded-lg border border-gray-100 p-3 text-sm">
            <span className="flex items-center gap-2">
              <input type="radio" name="cadence" value={o.value} defaultChecked={selected === o.value} />
              {o.label}
            </span>
            <span className={`text-xs ${fits(o.runsPerMonth) ? "text-gray-400" : "text-amber-700"}`}>
              ≈ {(perRun * o.runsPerMonth).toLocaleString()} credits / month{fits(o.runsPerMonth) ? "" : " — exceeds your plan"}
            </span>
          </label>
        ))}
      </fieldset>
      {!fits(OPTIONS[OPTIONS.length - 1].runsPerMonth) ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Even a weekly schedule needs more credits than your plan includes. Runs stop when credits run out — track fewer prompts or upgrade.
        </p>
      ) : null}
      <p className="text-xs text-gray-500">
        {count?.n ?? 0} prompts × {plan.models.length} AI models = {perRun} answers (credits) per run on the {plan.label} plan ({plan.monthlyCredits || "custom"} credits/month).
      </p>
    </ActionForm>
  );
}
