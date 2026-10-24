import { getTranslations } from "@/lib/i18n/server";
import { ActionForm } from "@/components/action-form";
import { addScheduleAction, cadenceAction, archiveScheduleAction } from "../actions";

const CADENCES = [
  ["daily", "Daily"],
  ["every_3_days", "Every 3 days"],
  ["weekly", "Weekly"],
] as const;

async function CadenceSelect({ value }: { value?: string }) {
  const tt = await getTranslations();
  return (
    <select name="cadence" defaultValue={value ?? "daily"} className="input !w-auto !py-1 text-xs" aria-label={tt("Cadence")}>
      {CADENCES.map(([v, l]) => (
        <option key={v} value={v}>
          {tt(l)}
        </option>
      ))}
    </select>
  );
}

export async function SchedulesTab({
  schedules,
  canWrite,
}: {
  schedules: { id: string; name: string; kind: string; cadence: string; promptCount: number }[];
  canWrite: boolean;
}) {
  const tt = await getTranslations();
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        {tt("Every prompt belongs to one schedule. Move prompts between schedules with the bulk “Set schedule” action in Prompt Universe.")}</p>
      {canWrite ? (
        <ActionForm action={addScheduleAction} submitLabel={tt("Create schedule")} resetOnSuccess className="flex flex-wrap items-center gap-2">
          <input name="name" className="input !w-56" placeholder={tt("e.g. Low priority")} required maxLength={60} />
          <CadenceSelect />
        </ActionForm>
      ) : null}
      {schedules.length === 0 ? (
        <p className="text-sm text-gray-400">{tt("No schedule yet — finish onboarding or create one above.")}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="text-sm">
                {s.name} {s.kind === "default" ? <span className="badge bg-brand-50 text-brand-600">{tt("default")}</span> : null}
                <span className="ml-2 text-xs text-gray-400">{s.promptCount} {tt(" prompts")}</span>
              </span>
              {canWrite ? (
                <span className="flex items-center gap-2">
                  <ActionForm action={cadenceAction} submitLabel={tt("Save")} variant="secondary" className="flex items-center gap-2">
                    <input type="hidden" name="scheduleId" value={s.id} />
                    <CadenceSelect value={s.cadence} />
                  </ActionForm>
                  {s.kind !== "default" ? (
                    <ActionForm action={archiveScheduleAction} submitLabel={tt("Archive")} variant="secondary" confirm={tt("Archive {0}? Its prompts move to the default schedule.", { 0: s.name })}>
                      <input type="hidden" name="scheduleId" value={s.id} />
                    </ActionForm>
                  ) : null}
                </span>
              ) : (
                <span className="text-xs text-gray-500">{tt(s.cadence.replace(/_/g, " "))}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
