import Link from "next/link";
import { db } from "@athena/db";
import { MODEL_LABELS } from "@athena/core";
import { listResponses, responseMatrix } from "@athena/core/analytics";
import { listTopics, listPersonas, listLocations, listTags } from "@athena/core/prompts";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/lib/workspace";
import { getCompetitorList } from "@/lib/data";
import { parseResponsesState, responsesFilters, responsesQuery } from "@/lib/responses-state";

export const metadata = { title: "Responses" };

const PAGE = 50;
const LABELS: Record<string, string> = { ...MODEL_LABELS, simulated: "Simulated (dev)" };

function Select({ name, value, options, all }: { name: string; value?: string; options: { id: string; name: string }[]; all: string }) {
  return (
    <select name={name} aria-label={all} defaultValue={value ?? ""} className="input !w-auto !py-1.5 text-xs">
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export default async function ResponsesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
        title="Responses"
        subtitle="Every AI answer collected for your tracked prompts"
        actions={
          <a href={`/api/responses/export?${q}`} className="btn-secondary text-xs">
            Export CSV
          </a>
        }
      />
      <div className="space-y-4 p-6">
        <form action="/responses" className="flex flex-wrap items-center gap-2 text-xs">
          <input name="q" defaultValue={state.q ?? ""} placeholder="Search prompts and answers" className="input !w-56 !py-1.5 text-xs" />
          <select name="range" aria-label="Date range" defaultValue={state.base.range} className="input !w-auto !py-1.5 text-xs">
            <option value="7d">Last 7 days</option>
            <option value="14d">Last 14 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <select name="mentioned" aria-label="Brand mentioned" defaultValue={yn(state.mentioned)} className="input !w-auto !py-1.5 text-xs">
            <option value="">Mentioned or not</option>
            <option value="yes">Brand mentioned</option>
            <option value="no">Brand not mentioned</option>
          </select>
          <select name="cited" aria-label="Brand cited" defaultValue={yn(state.cited)} className="input !w-auto !py-1.5 text-xs">
            <option value="">Cited or not</option>
            <option value="yes">Your site cited</option>
            <option value="no">Not cited</option>
          </select>
          <Select name="competitorId" value={state.competitorId} options={comps} all="Any competitor" />
          <Select name="topicId" value={state.base.topicId} options={topics} all="All topics" />
          <Select name="personaId" value={state.base.personaId} options={personas} all="All personas" />
          <Select name="locationId" value={state.base.locationId} options={locations} all="All locations" />
          <Select name="tagId" value={state.base.tagId} options={tags} all="All tags" />
          <select name="view" aria-label="View" defaultValue={state.view} className="input !w-auto !py-1.5 text-xs">
            <option value="table">Answer list</option>
            <option value="matrix">Prompt × model matrix</option>
          </select>
          <button type="submit" className="btn-secondary !py-1.5 text-xs">
            Apply
          </button>
        </form>

        {list ? (
          list.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
              No answers match.{" "}
              <Link href="/prompts?tab=runs" className="text-brand-600 underline">
                Run a collection
              </Link>{" "}
              or widen the filters.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Prompt</th>
                      <th>Model</th>
                      <th>Mentioned</th>
                      <th>Sentiment</th>
                      <th>Sources</th>
                      <th>Cited</th>
                      <th>Competitors</th>
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
                          {LABELS[r.model] ?? r.model}
                          {r.simulated ? <span className="ml-1 badge bg-amber-50 text-amber-700">sim</span> : null}
                        </td>
                        <td>{r.mentioned ? <span className="badge bg-emerald-50 text-emerald-700">#{r.position ?? "?"}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="text-xs text-gray-500">{r.mentioned ? r.sentiment : "—"}</td>
                        <td className="text-xs text-gray-500" title={r.topDomains.join(", ")}>
                          {r.sourcesCount}
                          {r.topDomains.length ? <span className="text-gray-400"> · {r.topDomains.join(", ")}</span> : null}
                        </td>
                        <td>{r.cited ? <span className="badge bg-brand-50 text-brand-600">cited</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="text-xs text-gray-500">{r.competitors.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{list.total.toLocaleString()} answers</span>
                {state.page > 1 ? <Link href={`/responses?${responsesQuery(state, { page: state.page - 1 })}`}>← Previous</Link> : null}
                {pages > 1 ? (
                  <span>
                    Page {state.page} of {pages}
                  </span>
                ) : null}
                {state.page < pages ? <Link href={`/responses?${responsesQuery(state, { page: state.page + 1 })}`}>Next →</Link> : null}
              </div>
            </>
          )
        ) : null}

        {matrix ? (
          matrix.rows.length === 0 ? (
            <p className="text-sm text-gray-400">No answers in this period.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Prompt (latest answer per model)</th>
                    {matrix.models.map((m) => (
                      <th key={m} className="text-center">
                        {LABELS[m] ?? m}
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
                              <Link href={`/responses/${cell.responseId}`} title={`${cell.ranAt.toISOString().slice(0, 10)}${cell.cited ? " · cited" : ""}`}>
                                {cell.mentioned ? (
                                  <span className={`badge ${cell.cited ? "bg-brand-50 text-brand-600" : "bg-emerald-50 text-emerald-700"}`}>#{cell.position ?? "?"}</span>
                                ) : (
                                  <span className="badge bg-gray-100 text-gray-400">not mentioned</span>
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
