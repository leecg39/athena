import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { db } from "@athena/db";
import { MODEL_LABELS } from "@athena/core";
import { listResponses, responseMatrix } from "@athena/core/analytics";
import { listTopics, listPersonas, listLocations, listTags } from "@athena/core/prompts";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/lib/workspace";
import { getCompetitorList } from "@/lib/data";
import { parseResponsesState, responsesFilters, responsesQuery } from "@/lib/responses-state";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Responses") };
}

const PAGE = 50;
const LABELS: Record<string, string> = { ...MODEL_LABELS, simulated: "Simulated (dev)" };

async function Select({ name, value, options, all }: { name: string; value?: string; options: { id: string; name: string }[]; all: string }) {
  const tt = await getTranslations();
  return (
    <select name={name} aria-label={tt(all)} defaultValue={value ?? ""} className="input !w-auto !py-1.5 text-xs">
      <option value="">{tt(all)}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export default async function ResponsesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tt = await getTranslations();
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const state = parseResponsesState(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v])));
  const filters = responsesFilters(state);
  const c = { actorId: ws.user.id, websiteId: ws.websiteId };
  const [topics, personas, locations, tags, comps] = await Promise.all([listTopics(db, c), listPersonas(db, c), listLocations(db, c), listTags(db, c), getCompetitorList(ws.websiteId)]);
  const list = state.view === "table" ? await listResponses(db, { ...c, filters, limit: PAGE, offset: (state.page - 1) * PAGE }) : null;
  const matrix = state.view === "matrix" ? await responseMatrix(db, { ...c, filters }) : null;
  const q = responsesQuery(state);
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE)) : 1;
  const yn = (v?: boolean) => (v === undefined ? "" : v ? "yes" : "no");

  return (
    <div>
      <PageHeader
        title={tt("Responses")}
        subtitle={tt("Every AI answer collected for your tracked prompts")}
        actions={
          <a href={`/api/responses/export?${q}`} className="btn-secondary text-xs">
            {tt("Export CSV")}</a>
        }
      />
      <div className="space-y-4 p-6">
        <form action="/responses" className="flex flex-wrap items-center gap-2 text-xs">
          <input name="q" defaultValue={state.q ?? ""} placeholder={tt("Search prompts and answers")} className="input !w-56 !py-1.5 text-xs" />
          <select name="range" aria-label={tt("Date range")} defaultValue={state.base.range} className="input !w-auto !py-1.5 text-xs">
            <option value="7d">{tt("Last 7 days")}</option>
            <option value="14d">{tt("Last 14 days")}</option>
            <option value="30d">{tt("Last 30 days")}</option>
            <option value="90d">{tt("Last 90 days")}</option>
          </select>
          <select name="mentioned" aria-label={tt("Brand mentioned")} defaultValue={yn(state.mentioned)} className="input !w-auto !py-1.5 text-xs">
            <option value="">{tt("Mentioned or not")}</option>
            <option value="yes">{tt("Brand mentioned")}</option>
            <option value="no">{tt("Brand not mentioned")}</option>
          </select>
          <select name="cited" aria-label={tt("Brand cited")} defaultValue={yn(state.cited)} className="input !w-auto !py-1.5 text-xs">
            <option value="">{tt("Cited or not")}</option>
            <option value="yes">{tt("Your site cited")}</option>
            <option value="no">{tt("Not cited")}</option>
          </select>
          <Select name="competitorId" value={state.competitorId} options={comps} all={tt("Any competitor")} />
          <Select name="topicId" value={state.base.topicId} options={topics} all={tt("All topics")} />
          <Select name="personaId" value={state.base.personaId} options={personas} all={tt("All personas")} />
          <Select name="locationId" value={state.base.locationId} options={locations} all={tt("All locations")} />
          <Select name="tagId" value={state.base.tagId} options={tags} all={tt("All tags")} />
          <select name="view" aria-label={tt("View")} defaultValue={state.view} className="input !w-auto !py-1.5 text-xs">
            <option value="table">{tt("Answer list")}</option>
            <option value="matrix">{tt("Prompt × model matrix")}</option>
          </select>
          <button type="submit" className="btn-secondary !py-1.5 text-xs">
            {tt("Apply")}</button>
        </form>

        {list ? (
          list.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
              {tt("No answers match.")}{tt(" ")}
              <Link href="/prompts?tab=runs" className="text-brand-600 underline">
                {tt("Run a collection")}</Link>{tt(" ")}
              {tt("or widen the filters.")}</div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{tt("Date")}</th>
                      <th>{tt("Prompt")}</th>
                      <th>{tt("Model")}</th>
                      <th>{tt("Mentioned")}</th>
                      <th>{tt("Sentiment")}</th>
                      <th>{tt("Sources")}</th>
                      <th>{tt("Cited")}</th>
                      <th>{tt("Competitors")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-xs text-gray-400">{r.ranAt.toISOString().slice(0, 10)}</td>
                        <td className="max-w-sm">
                          <Link href={`/responses/${r.id}`} className="text-gray-900 hover:text-brand-600 hover:underline">
                            {r.promptText}
                          </Link>
                          {r.topicName ? <div className="text-[11px] text-gray-400">{r.topicName}</div> : null}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {tt(LABELS[r.model] ?? r.model)}
                          {r.simulated ? <span className="ml-1 badge bg-amber-50 text-amber-700">{tt("sim")}</span> : null}
                        </td>
                        <td>{r.mentioned ? <span className="badge bg-emerald-50 text-emerald-700">#{r.position ?? "?"}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="text-xs text-gray-500">{tt(r.mentioned ? r.sentiment : "—")}</td>
                        <td className="text-xs text-gray-500" title={tt(r.topDomains.join(", "))}>
                          {r.sourcesCount}
                          {r.topDomains.length ? <span className="text-gray-400"> · {r.topDomains.join(", ")}</span> : null}
                        </td>
                        <td>{r.cited ? <span className="badge bg-brand-50 text-brand-600">{tt("cited")}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="text-xs text-gray-500">{r.competitors.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{list.total.toLocaleString()} {tt(" answers")}</span>
                {state.page > 1 ? <Link href={`/responses?${responsesQuery(state, { page: state.page - 1 })}`}>{tt("← Previous")}</Link> : null}
                {pages > 1 ? (
                  <span>
                    {tt("Page ")}{state.page} {tt(" of ")}{pages}
                  </span>
                ) : null}
                {state.page < pages ? <Link href={`/responses?${responsesQuery(state, { page: state.page + 1 })}`}>{tt("Next →")}</Link> : null}
              </div>
            </>
          )
        ) : null}

        {matrix ? (
          matrix.rows.length === 0 ? (
            <p className="text-sm text-gray-400">{tt("No answers in this period.")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{tt("Prompt (latest answer per model)")}</th>
                    {matrix.models.map((m) => (
                      <th key={m} className="text-center">
                        {tt(LABELS[m] ?? m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row) => (
                    <tr key={row.promptId}>
                      <td className="max-w-sm text-gray-900">{row.promptText}</td>
                      {matrix.models.map((m) => {
                        const cell = row.cells[m];
                        return (
                          <td key={m} className="text-center">
                            {cell ? (
                              <Link href={`/responses/${cell.responseId}`} title={tt("{0}{1}", { 0: cell.ranAt.toISOString().slice(0, 10), 1: cell.cited ? " · cited" : "" })}>
                                {cell.mentioned ? (
                                  <span className={`badge ${cell.cited ? "bg-brand-50 text-brand-600" : "bg-emerald-50 text-emerald-700"}`}>#{cell.position ?? "?"}</span>
                                ) : (
                                  <span className="badge bg-gray-100 text-gray-400">{tt("not mentioned")}</span>
                                )}
                              </Link>
                            ) : (
                              <span className="text-gray-200">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
