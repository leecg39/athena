import { getTranslations } from "@/lib/i18n/server";
import { ActionForm } from "@/components/action-form";
import {
  addTopicAction,
  renameTopicAction,
  deleteTopicAction,
  addTagAction,
  deleteTagAction,
  addPersonaAction,
  deletePersonaAction,
  addLocationAction,
  deleteLocationAction,
} from "../actions";

async function Empty({ label }: { label: string }) {
  const tt = await getTranslations();
  return <p className="text-sm text-gray-400">{tt(label)}</p>;
}

export async function TopicsTab({ topics, canWrite }: { topics: { id: string; name: string; promptCount: number }[]; canWrite: boolean }) {
  const tt = await getTranslations();
  return (
    <div className="space-y-4">
      {canWrite ? (
        <ActionForm action={addTopicAction} submitLabel={tt("Add topic")} resetOnSuccess className="flex flex-wrap gap-2">
          <input name="name" className="input !w-64" placeholder={tt("Topic name")} required maxLength={80} />
          <input name="description" className="input min-w-[240px] flex-1" placeholder={tt("Description (optional)")} maxLength={300} />
        </ActionForm>
      ) : null}
      {topics.length === 0 ? (
        <Empty label={tt("No topics yet.")} />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
          {topics.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              {canWrite ? (
                <ActionForm action={renameTopicAction} submitLabel={tt("Rename")} variant="secondary" className="flex items-center gap-2">
                  <input type="hidden" name="topicId" value={t.id} />
                  <input name="name" className="input !w-64 !py-1 text-sm" defaultValue={t.name} required maxLength={80} aria-label={tt("Rename {0}", { 0: t.name })} />
                </ActionForm>
              ) : (
                <span className="text-sm">{t.name}</span>
              )}
              <span className="flex items-center gap-3 text-xs text-gray-400">
                {t.promptCount} {tt(" prompts")}{canWrite ? (
                  <ActionForm action={deleteTopicAction} submitLabel={tt("Delete")} variant="secondary" confirm={tt("Delete topic {0}? Its prompts stay tracked without a topic.", { 0: t.name })}>
                    <input type="hidden" name="topicId" value={t.id} />
                  </ActionForm>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function TagsTab({ tags, canWrite }: { tags: { id: string; name: string; color: string | null; promptCount: number }[]; canWrite: boolean }) {
  const tt = await getTranslations();
  return (
    <div className="space-y-4">
      {canWrite ? (
        <ActionForm action={addTagAction} submitLabel={tt("Add tag")} resetOnSuccess className="flex flex-wrap items-center gap-2">
          <input name="name" className="input !w-56" placeholder={tt("Tag name")} required maxLength={40} />
          <input name="color" type="color" defaultValue="#4f39f6" aria-label={tt("Tag color")} className="h-9 w-12 rounded border border-gray-200" />
        </ActionForm>
      ) : null}
      {tags.length === 0 ? (
        <Empty label={tt("No tags yet. Tag prompts in bulk from the Prompt Universe tab.")} />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-sm">
              <span className="h-3 w-3 rounded-full" style={{ background: t.color ?? "#4f39f6" }} aria-hidden />
              {t.name} <span className="text-xs text-gray-400">{t.promptCount}</span>
              {canWrite ? (
                <ActionForm action={deleteTagAction} submitLabel={tt("×")} variant="secondary" confirm={tt("Delete tag {0}?", { 0: t.name })}>
                  <input type="hidden" name="tagId" value={t.id} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function PersonasTab({ personas, canWrite }: { personas: { id: string; name: string; description: string | null }[]; canWrite: boolean }) {
  const tt = await getTranslations();
  return (
    <div className="space-y-4">
      {canWrite ? (
        <ActionForm action={addPersonaAction} submitLabel={tt("Add persona")} resetOnSuccess className="flex flex-wrap gap-2">
          <input name="name" className="input !w-56" placeholder={tt("Persona name")} required maxLength={60} />
          <input name="description" className="input min-w-[240px] flex-1" placeholder={tt("Who they are and what they need")} maxLength={300} />
        </ActionForm>
      ) : null}
      {personas.length === 0 ? (
        <Empty label={tt("No personas yet.")} />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {personas.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2 rounded-xl border border-gray-100 p-3">
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-gray-500">{tt(p.description)}</div>
              </div>
              {canWrite ? (
                <ActionForm action={deletePersonaAction} submitLabel={tt("Delete")} variant="secondary" confirm={tt("Delete persona {0}?", { 0: p.name })}>
                  <input type="hidden" name="personaId" value={p.id} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function LocationsTab({ locations, canWrite, defaultCountry }: { locations: { id: string; name: string; country: string }[]; canWrite: boolean; defaultCountry: string }) {
  const tt = await getTranslations();
  return (
    <div className="space-y-4">
      {canWrite ? (
        <ActionForm action={addLocationAction} submitLabel={tt("Add location")} resetOnSuccess className="flex flex-wrap gap-2">
          <input name="name" className="input !w-56" placeholder={tt("City or region")} required maxLength={80} />
          <input name="country" className="input !w-20 uppercase" defaultValue={defaultCountry} maxLength={2} required aria-label={tt("Country code")} />
        </ActionForm>
      ) : null}
      {locations.length === 0 ? (
        <Empty label={tt("No locations yet — answers are sampled for your primary market.")} />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
          {locations.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {l.name} <span className="text-xs text-gray-400">{l.country}</span>
              </span>
              {canWrite ? (
                <ActionForm action={deleteLocationAction} submitLabel={tt("Remove")} variant="secondary">
                  <input type="hidden" name="locationId" value={l.id} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
