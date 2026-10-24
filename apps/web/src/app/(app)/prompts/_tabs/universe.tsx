import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import type { PromptListItem } from "@athena/core/prompts";
import { ActionForm } from "@/components/action-form";
import { addPromptAction, editPromptAction, bulkAction } from "../actions";

interface Option {
  id: string;
  name: string;
}

export interface UniverseProps {
  rows: PromptListItem[];
  total: number;
  topics: Option[];
  tags: Option[];
  personas: Option[];
  locations: Option[];
  schedules: Option[];
  filters: Record<string, string | undefined>;
  editId?: string;
  canWrite: boolean;
  page: number;
  pageSize: number;
}

function qs(filters: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ tab: "prompt-universe", ...filters, ...patch })) if (v) p.set(k, v);
  return `/prompts?${p.toString()}`;
}

async function Select({ name, label, options, value, empty }: { name: string; label: string; options: Option[]; value?: string | null; empty: string }) {
  const tt = await getTranslations();
  return (
    <select name={name} aria-label={tt(label)} defaultValue={value ?? ""} className="input !w-auto !py-1.5 text-xs">
      <option value="">{tt(empty)}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export async function UniverseTab(p: UniverseProps) {
  const tt = await getTranslations();
  const editing = p.editId ? p.rows.find((r) => r.id === p.editId) : undefined;
  const pages = Math.max(1, Math.ceil(p.total / p.pageSize));
  return (
    <div className="space-y-4">
      {p.canWrite ? (
        <ActionForm action={addPromptAction} submitLabel={tt("+ Track prompt")} resetOnSuccess className="flex flex-wrap items-center gap-2">
          <input name="text" className="input min-w-[280px] flex-1" placeholder={tt("Add a prompt to track, e.g. best tools for…")} required maxLength={500} />
          <Select name="topicId" label={tt("Topic")} options={p.topics} empty={tt("No topic")} />
          <Select name="personaId" label={tt("Persona")} options={p.personas} empty={tt("Any persona")} />
        </ActionForm>
      ) : null}

      {editing && p.canWrite ? (
        <ActionForm action={editPromptAction} submitLabel={tt("Save prompt")} className="space-y-2 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
          <input type="hidden" name="promptId" value={editing.id} />
          <input name="text" className="input" defaultValue={editing.text} required maxLength={500} aria-label={tt("Prompt text")} />
          <div className="flex flex-wrap gap-2">
            <Select name="topicId" label={tt("Topic")} options={p.topics} value={editing.topicId} empty={tt("No topic")} />
            <Select name="personaId" label={tt("Persona")} options={p.personas} value={editing.personaId} empty={tt("Any persona")} />
            <Select name="locationId" label={tt("Location")} options={p.locations} value={editing.locationId} empty={tt("Default location")} />
            <Link href={qs(p.filters, { edit: undefined })} className="btn-secondary text-xs">
              {tt("Cancel")}</Link>
          </div>
        </ActionForm>
      ) : null}

      <form action="/prompts" className="flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="tab" value="prompt-universe" />
        <input name="q" className="input !w-56 !py-1.5 text-xs" placeholder={tt("Search prompts")} defaultValue={p.filters.q ?? ""} />
        <Select name="topicId" label={tt("Filter by topic")} options={p.topics} value={p.filters.topicId} empty={tt("All topics")} />
        <Select name="tagId" label={tt("Filter by tag")} options={p.tags} value={p.filters.tagId} empty={tt("All tags")} />
        <Select name="personaId" label={tt("Filter by persona")} options={p.personas} value={p.filters.personaId} empty={tt("All personas")} />
        <select name="status" aria-label={tt("Filter by status")} defaultValue={p.filters.status ?? ""} className="input !w-auto !py-1.5 text-xs">
          <option value="">{tt("Any status")}</option>
          <option value="active">{tt("Active")}</option>
          <option value="paused">{tt("Paused")}</option>
        </select>
        <select name="type" aria-label={tt("Filter by type")} defaultValue={p.filters.type ?? ""} className="input !w-auto !py-1.5 text-xs">
          <option value="">{tt("Branded + non-branded")}</option>
          <option value="branded">{tt("Branded")}</option>
          <option value="non_branded">{tt("Non-branded")}</option>
        </select>
        <button type="submit" className="btn-secondary !py-1.5 text-xs">
          {tt("Filter")}</button>
        <span className="text-gray-400">{p.total} {tt(" prompts")}</span>
      </form>

      {p.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
          {tt("No prompts match. Add one above or use the Discover tab.")}</div>
      ) : (
        <ActionForm action={bulkAction} submitLabel={tt("Apply to selected")} variant="secondary" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select name="action" aria-label={tt("Bulk action")} className="input !w-auto !py-1.5 text-xs" defaultValue="pause">
              <option value="pause">{tt("Pause")}</option>
              <option value="resume">{tt("Resume")}</option>
              <option value="move_topic">{tt("Move to topic…")}</option>
              <option value="tag">{tt("Add tag…")}</option>
              <option value="untag">{tt("Remove tag…")}</option>
              <option value="set_schedule">{tt("Set schedule…")}</option>
              <option value="delete">{tt("Delete")}</option>
            </select>
            <select name="value" aria-label={tt("Bulk action target")} className="input !w-auto !py-1.5 text-xs" defaultValue="">
              <option value="">{tt("— target (topic / tag / schedule) —")}</option>
              <optgroup label={tt("Topics")}>
                {p.topics.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={tt("Tags")}>
                {p.tags.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={tt("Schedules")}>
                {p.schedules.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-8">
                    <span className="sr-only">{tt("Select")}</span>
                  </th>
                  <th>{tt("Prompt")}</th>
                  <th>{tt("Topic")}</th>
                  <th>{tt("Tags")}</th>
                  <th>{tt("Persona")}</th>
                  <th>{tt("Type")}</th>
                  <th>{tt("Volume")}</th>
                  <th>{tt("Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.id} className={r.status === "paused" ? "opacity-60" : ""}>
                    <td>
                      <input type="checkbox" name="ids" value={r.id} aria-label={tt("Select {0}", { 0: r.text })} />
                    </td>
                    <td className="max-w-md text-gray-900">{r.text}</td>
                    <td className="text-xs text-gray-500">{r.topicName ?? "—"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <span key={t.id} className="badge text-[10px] text-white" style={{ background: t.color ?? "#4f39f6" }}>
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-xs text-gray-500">{r.personaName ?? "—"}</td>
                    <td>
                      <span className={`badge ${r.type === "branded" ? "bg-brand-50 text-brand-600" : "bg-gray-100 text-gray-600"}`}>{tt(r.type === "branded" ? "branded" : "non-branded")}</span>
                    </td>
                    <td className="text-xs text-gray-500">{tt(r.volumeEstimate ? r.volumeEstimate.toLocaleString() : "—")}</td>
                    <td>
                      <span className={`badge ${r.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{tt(r.status)}</span>
                    </td>
                    <td className="whitespace-nowrap text-right text-xs">
                      {p.canWrite ? (
                        <Link href={qs(p.filters, { edit: r.id })} className="text-brand-600 hover:underline">
                          {tt("Edit")}</Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      )}
      {pages > 1 ? (
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {p.page > 1 ? <Link href={qs(p.filters, { page: String(p.page - 1) })}>{tt("← Previous")}</Link> : null}
          <span>
            {tt("Page ")}{p.page} {tt(" of ")}{pages}
          </span>
          {p.page < pages ? <Link href={qs(p.filters, { page: String(p.page + 1) })}>{tt("Next →")}</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
