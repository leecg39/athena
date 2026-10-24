import { getTranslations } from "@/lib/i18n/server";
import type { DashboardState } from "@athena/core/analytics";

interface Option {
  id: string;
  name: string;
}

async function Select({ name, label, value, options, all }: { name: string; label: string; value?: string; options: Option[]; all: string }) {
  const tt = await getTranslations();
  return (
    <select name={name} aria-label={tt(label)} defaultValue={value ?? ""} className="input !w-auto !py-1.5 text-xs">
      <option value="">{tt(all)}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** GET form: every filter lives in the URL so views are shareable and bookmarkable. */
export async function FilterBar({
  state,
  models,
  topics,
  personas,
  locations,
  tags,
}: {
  state: DashboardState;
  models: Option[];
  topics: Option[];
  personas: Option[];
  locations: Option[];
  tags: Option[];
}) {
  const tt = await getTranslations();
  return (
    <form action="/olympus" className="flex flex-wrap items-center gap-2 text-xs">
      <select name="range" aria-label={tt("Date range")} defaultValue={state.range} className="input !w-auto !py-1.5 text-xs">
        <option value="7d">{tt("Last 7 days")}</option>
        <option value="14d">{tt("Last 14 days")}</option>
        <option value="30d">{tt("Last 30 days")}</option>
        <option value="90d">{tt("Last 90 days")}</option>
        <option value="custom">{tt("Custom…")}</option>
      </select>
      <input type="date" name="from" aria-label={tt("From (custom range)")} title={tt("Used when the range is Custom")} defaultValue={state.from} className="input !w-auto !py-1 text-xs" />
      <input type="date" name="to" aria-label={tt("To (custom range)")} title={tt("Used when the range is Custom")} defaultValue={state.to} className="input !w-auto !py-1 text-xs" />
      <fieldset className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-2 py-1">
        <legend className="sr-only">{tt("AI models")}</legend>
        {models.map((m) => (
          <label key={m.id} className="flex items-center gap-1">
            <input type="checkbox" name="models" value={m.id} defaultChecked={state.models.includes(m.id)} /> {tt(m.name)}
          </label>
        ))}
      </fieldset>
      <Select name="topicId" label={tt("Topic")} value={state.topicId} options={topics} all={tt("All topics")} />
      <Select name="personaId" label={tt("Persona")} value={state.personaId} options={personas} all={tt("All personas")} />
      <Select name="locationId" label={tt("Location")} value={state.locationId} options={locations} all={tt("All locations")} />
      <Select name="tagId" label={tt("Tag")} value={state.tagId} options={tags} all={tt("All tags")} />
      <select name="type" aria-label={tt("Prompt type")} defaultValue={state.type ?? ""} className="input !w-auto !py-1.5 text-xs">
        <option value="">{tt("All prompts")}</option>
        <option value="branded">{tt("Branded")}</option>
        <option value="non_branded">{tt("Non-branded")}</option>
      </select>
      <select name="chart" aria-label={tt("Chart detail")} defaultValue={state.chart} className="input !w-auto !py-1.5 text-xs">
        <option value="detailed">{tt("Detailed")}</option>
        <option value="simple">{tt("Simple")}</option>
      </select>
      {state.cards.length ? <input type="hidden" name="cards" value={state.cards.join(",")} /> : null}
      <button type="submit" className="btn-secondary !py-1.5 text-xs">
        {tt("Apply")}</button>
    </form>
  );
}
