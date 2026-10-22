import type { DashboardState } from "@athena/core/analytics";

interface Option {
  id: string;
  name: string;
}

function Select({ name, label, value, options, all }: { name: string; label: string; value?: string; options: Option[]; all: string }) {
  return (
    <select name={name} aria-label={label} defaultValue={value ?? ""} className="input !w-auto !py-1.5 text-xs">
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** GET form: every filter lives in the URL so views are shareable and bookmarkable. */
export function FilterBar({
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
  return (
    <form action="/olympus" className="flex flex-wrap items-center gap-2 text-xs">
      <select name="range" aria-label="Date range" defaultValue={state.range} className="input !w-auto !py-1.5 text-xs">
        <option value="7d">Last 7 days</option>
        <option value="14d">Last 14 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="custom">Custom…</option>
      </select>
      <input type="date" name="from" aria-label="From (custom range)" title="Used when the range is Custom" defaultValue={state.from} className="input !w-auto !py-1 text-xs" />
      <input type="date" name="to" aria-label="To (custom range)" title="Used when the range is Custom" defaultValue={state.to} className="input !w-auto !py-1 text-xs" />
      <fieldset className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-2 py-1">
        <legend className="sr-only">AI models</legend>
        {models.map((m) => (
          <label key={m.id} className="flex items-center gap-1">
            <input type="checkbox" name="models" value={m.id} defaultChecked={state.models.includes(m.id)} /> {m.name}
          </label>
        ))}
      </fieldset>
      <Select name="topicId" label="Topic" value={state.topicId} options={topics} all="All topics" />
      <Select name="personaId" label="Persona" value={state.personaId} options={personas} all="All personas" />
      <Select name="locationId" label="Location" value={state.locationId} options={locations} all="All locations" />
      <Select name="tagId" label="Tag" value={state.tagId} options={tags} all="All tags" />
      <select name="type" aria-label="Prompt type" defaultValue={state.type ?? ""} className="input !w-auto !py-1.5 text-xs">
        <option value="">All prompts</option>
        <option value="branded">Branded</option>
        <option value="non_branded">Non-branded</option>
      </select>
      <select name="chart" aria-label="Chart detail" defaultValue={state.chart} className="input !w-auto !py-1.5 text-xs">
        <option value="detailed">Detailed</option>
        <option value="simple">Simple</option>
      </select>
      {state.cards.length ? <input type="hidden" name="cards" value={state.cards.join(",")} /> : null}
      <button type="submit" className="btn-secondary !py-1.5 text-xs">
        Apply
      </button>
    </form>
  );
}
