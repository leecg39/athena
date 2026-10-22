import { and, desc, eq } from "drizzle-orm";
import { db, runs, organizations } from "@athena/db";
import { AI_MODELS, MODEL_LABELS, PLANS } from "@athena/core";
import { configuredAdapters, simulatedEnabled } from "@athena/llm/providers";
import { ActionForm } from "@/components/action-form";
import { RunProgressBar } from "./run-progress";
import { startRunAction, cancelRunAction } from "../actions";

const NO_API = new Set(["ai_overview", "ai_mode", "copilot", "meta_ai", "mistral"]);

export async function RunsTab({ websiteId, organizationId, canWrite }: { websiteId: string; organizationId: string; canWrite: boolean }) {
  const [[org], recent] = await Promise.all([
    db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, organizationId)),
    db.select().from(runs).where(and(eq(runs.websiteId, websiteId))).orderBy(desc(runs.createdAt)).limit(20),
  ]);
  const plan = PLANS[org?.plan ?? "free"];
  const configured = new Set(configuredAdapters().map((a) => a.model as string));
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Collect AI answers now</h2>
            <p className="text-xs text-gray-500">Asks every active prompt to each available model. 1 credit per answer; failed answers are refunded.</p>
          </div>
          {canWrite ? <ActionForm action={startRunAction} submitLabel="Run collection" /> : null}
        </div>
        <ul className="mt-4 grid gap-2 text-xs md:grid-cols-3">
          {AI_MODELS.map((m) => {
            const inPlan = (plan.models as readonly string[]).includes(m);
            const status = !inPlan ? "Not in your plan" : configured.has(m) ? "Ready" : NO_API.has(m) ? "No public API — not collectable" : "API key not configured";
            return (
              <li key={m} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <span>{MODEL_LABELS[m]}</span>
                <span className={status === "Ready" ? "text-emerald-600" : "text-gray-400"}>{status}</span>
              </li>
            );
          })}
          {simulatedEnabled() ? (
            <li className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <span>Simulated (dev)</span>
              <span className="text-amber-700">Synthetic answers — dev only</span>
            </li>
          ) : null}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Recent runs</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400">No collection runs yet.</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Started</th>
                <th>Trigger</th>
                <th>Models</th>
                <th>Progress</th>
                <th>Credits</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs text-gray-500">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="text-xs">{r.trigger}</td>
                  <td className="text-xs text-gray-500">{r.models.map((m) => MODEL_LABELS[m as keyof typeof MODEL_LABELS] ?? m).join(", ")}</td>
                  <td className="min-w-[220px]">
                    <RunProgressBar runId={r.id} initial={{ state: r.state, done: r.completedResponses, total: r.totalResponses, failed: r.failedResponses }} />
                  </td>
                  <td className="text-xs text-gray-500">
                    {r.creditsReserved - r.creditsRefunded}
                    {r.creditsRefunded ? ` (${r.creditsRefunded} refunded)` : ""}
                  </td>
                  <td className="text-right">
                    {canWrite && (r.state === "queued" || r.state === "running") ? (
                      <ActionForm action={cancelRunAction} submitLabel="Cancel" variant="secondary" confirm="Cancel this collection? Unprocessed answers are refunded.">
                        <input type="hidden" name="runId" value={r.id} />
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
