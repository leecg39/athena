import { getTranslations } from "@/lib/i18n/server";
import { ActionForm } from "@/components/action-form";
import { addCompetitorAction, editCompetitorAction, deleteCompetitorAction } from "../actions";

export interface TrackedCompetitor {
  id: string;
  name: string;
  domain: string;
}

async function EditableRow({ c }: { c: TrackedCompetitor }) {
  const tt = await getTranslations();
  return (
    <>
      <ActionForm action={editCompetitorAction} submitLabel={tt("Save")} variant="secondary" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="competitorId" value={c.id} />
        <input name="name" defaultValue={c.name} className="input !w-36 !py-1 text-xs" aria-label={tt("Competitor name")} required maxLength={80} />
        <input name="domain" defaultValue={c.domain} className="input !w-40 !py-1 text-xs" aria-label={tt("Competitor domain")} required />
      </ActionForm>
      <ActionForm action={deleteCompetitorAction} submitLabel={tt("Remove")} variant="secondary" confirm={tt("Stop tracking {0}?", { 0: c.name })}>
        <input type="hidden" name="competitorId" value={c.id} />
      </ActionForm>
    </>
  );
}

export async function TrackedCompetitors({ tracked, canWrite }: { tracked: TrackedCompetitor[]; canWrite: boolean }) {
  const tt = await getTranslations();
  return (
    <section className="rounded-xl border border-gray-100 p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{tt("Tracked competitors (")}{tracked.length})</h2>
      <ul className="space-y-2">
        {tracked.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <EditableRow c={t} />
            ) : (
              <span className="text-sm">
                {t.name} <span className="text-xs text-gray-400">{t.domain}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <ActionForm action={addCompetitorAction} submitLabel={tt("+ Add competitor")} className="mt-4 flex flex-wrap items-center gap-2" resetOnSuccess>
          <input name="name" placeholder={tt("Name")} className="input !w-36 !py-1 text-xs" required maxLength={80} />
          <input name="domain" placeholder={tt("domain.com")} className="input !w-40 !py-1 text-xs" required />
        </ActionForm>
      ) : null}
    </section>
  );
}
