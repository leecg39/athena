import Link from "next/link";
import { db } from "@athena/db";
import { MODEL_LABELS } from "@athena/core";
import {
  getVisibilityMetrics,
  getSearchValue,
  compareTotals,
  listViews,
  parseDashboardState,
  stateToFilters,
  stateToSearchParams,
} from "@athena/core/analytics";
import { listTopics, listPersonas, listLocations, listTags } from "@athena/core/prompts";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { requireWorkspace } from "@/lib/workspace";
import { FilterBar } from "./_components/filter-bar";
import { MetricCards } from "./_components/cards";
import { TrendChart } from "./_components/charts";
import { saveViewAction, deleteViewAction } from "./actions";

export const metadata = { title: "Olympus Dashboard" };

const LABELS: Record<string, string> = { ...MODEL_LABELS, simulated: "Simulated (dev)" };

export default async function OlympusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const c = { actorId: ws.user.id, websiteId: ws.websiteId };
  const views = await listViews(db, c);
  const activeView = typeof sp.view === "string" ? views.find((v) => v.id === sp.view) : undefined;
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
  const state = activeView?.state ?? parseDashboardState(flat);
  const { current, previous } = stateToFilters(state);

  const [metrics, prior, value, topics, personas, locations, tags] = await Promise.all([
    getVisibilityMetrics(db, { ...c, filters: current }),
    getVisibilityMetrics(db, { ...c, filters: previous }),
    getSearchValue(db, { ...c, filters: current }),
    listTopics(db, c),
    listPersonas(db, c),
    listLocations(db, c),
    listTags(db, c),
  ]);
  const delta = compareTotals(metrics.totals, prior.totals);
  const query = stateToSearchParams(state).toString();
  const modelOptions = [...new Set([...metrics.byModel.map((m) => m.model), ...state.models])].map((id) => ({ id, name: LABELS[id] ?? id }));

  return (
    <div>
      <PageHeader
        title="Olympus Dashboard"
        subtitle={`AI search visibility for ${ws.website.name}`}
        actions={
          <a href={`/api/olympus/export?${query}`} className="btn-secondary text-xs">
            Export CSV
          </a>
        }
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Views:</span>
          <Link href="/olympus" className={`badge ${activeView ? "bg-gray-100 text-gray-600" : "bg-brand-50 text-brand-600"}`}>
            Default
          </Link>
          {views.map((v) => (
            <Link key={v.id} href={`/olympus?view=${v.id}`} className={`badge ${activeView?.id === v.id ? "bg-brand-50 text-brand-600" : "bg-gray-100 text-gray-600"}`}>
              {v.name}
            </Link>
          ))}
          {activeView ? (
            <ActionForm action={deleteViewAction} submitLabel="Delete view" variant="secondary" confirm={`Delete view ${activeView.name}?`}>
              <input type="hidden" name="viewId" value={activeView.id} />
            </ActionForm>
          ) : (
            <ActionForm action={saveViewAction} submitLabel="Save view" variant="secondary" className="flex items-center gap-2" resetOnSuccess>
              <input type="hidden" name="state" value={query} />
              <input name="name" className="input !w-40 !py-1 text-xs" placeholder="Name this view" required maxLength={60} />
            </ActionForm>
          )}
        </div>

        <FilterBar state={state} models={modelOptions} topics={topics} personas={personas} locations={locations} tags={tags} />

        {metrics.totals.simulatedShare > 0 ? (
          <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {metrics.totals.simulatedShare}% of these answers come from the dev-only simulated provider — not real AI output.
          </p>
        ) : null}

        {metrics.totals.responses === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
            No AI answers in this period.{" "}
            <Link href="/prompts?tab=runs" className="text-brand-600 underline">
              Run a collection
            </Link>{" "}
            or widen the filters.
          </div>
        ) : (
          <>
            <MetricCards cards={state.cards} totals={metrics.totals} delta={delta} value={value} />
            <TrendChart daily={metrics.daily} dailyByModel={metrics.dailyByModel} dailyEntities={metrics.dailyEntities} mode={state.chart} labels={LABELS} />
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-gray-100 p-4">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">By AI model</h2>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Answers</th>
                      <th>Mention</th>
                      <th>Citation</th>
                      <th>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.byModel.map((m) => (
                      <tr key={m.model}>
                        <td>{LABELS[m.model] ?? m.model}</td>
                        <td className="text-gray-500">{m.responses}</td>
                        <td>{m.mentionRate}%</td>
                        <td>{m.citationRate}%</td>
                        <td>{m.avgPosition === null ? "—" : `#${m.avgPosition}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="rounded-xl border border-gray-100 p-4">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">Share of voice</h2>
                <ul className="space-y-2">
                  {metrics.entities.map((e) => (
                    <li key={e.competitorId ?? "brand"} className="flex items-center gap-3 text-xs">
                      <span className={`w-28 truncate ${e.competitorId === null ? "font-semibold text-gray-900" : "text-gray-600"}`}>{e.name}</span>
                      <div className="h-2 flex-1 rounded-full bg-gray-100">
                        <div className={`h-2 rounded-full ${e.competitorId === null ? "bg-brand-600" : "bg-gray-400"}`} style={{ width: `${e.shareOfVoice}%` }} />
                      </div>
                      <span className="w-24 text-right text-gray-500">
                        {e.shareOfVoice}% · {e.mentions}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <p className="text-[11px] text-gray-400">
              {metrics.totals.responses.toLocaleString()} answers · {current.from.toISOString().slice(0, 10)} – {new Date(current.to.getTime() - 1).toISOString().slice(0, 10)} · days in {ws.website.timezone}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
