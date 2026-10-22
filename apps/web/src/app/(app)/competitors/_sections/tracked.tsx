import { ActionForm } from "@/components/action-form";
import { addCompetitorAction, editCompetitorAction, deleteCompetitorAction } from "../actions";

export interface TrackedCompetitor {
  id: string;
  name: string;
  domain: string;
}

function EditableRow({ c }: { c: TrackedCompetitor }) {
  return (
    <>
      <ActionForm action={editCompetitorAction} submitLabel="Save" variant="secondary" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="competitorId" value={c.id} />
        <input name="name" defaultValue={c.name} className="input !w-36 !py-1 text-xs" aria-label="Competitor name" required maxLength={80} />
        <input name="domain" defaultValue={c.domain} className="input !w-40 !py-1 text-xs" aria-label="Competitor domain" required />
      </ActionForm>
      <ActionForm action={deleteCompetitorAction} submitLabel="Remove" variant="secondary" confirm={`Stop tracking ${c.name}?`}>
        <input type="hidden" name="competitorId" value={c.id} />
      </ActionForm>
    </>
  );
}

export function TrackedCompetitors({ tracked, canWrite }: { tracked: TrackedCompetitor[]; canWrite: boolean }) {
  return (
    <section className="rounded-xl border border-gray-100 p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Tracked competitors ({tracked.length})</h2>
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
        <ActionForm action={addCompetitorAction} submitLabel="+ Add competitor" className="mt-4 flex flex-wrap items-center gap-2" resetOnSuccess>
          <input name="name" placeholder="Name" className="input !w-36 !py-1 text-xs" required maxLength={80} />
          <input name="domain" placeholder="domain.com" className="input !w-40 !py-1 text-xs" required />
        </ActionForm>
      ) : null}
    </section>
  );
}
