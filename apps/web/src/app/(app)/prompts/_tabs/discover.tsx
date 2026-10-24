"use client";
import { useTranslations } from "@/components/locale-provider";


import { useActionState } from "react";
import { ActionForm } from "@/components/action-form";
import { discoverAction, trackCandidatesAction, type DiscoverState } from "../actions";

const LABEL: Record<string, string> = {
  search_console: "Search demand",
  competitor_gap: "Competitor gap",
  site: "Site analysis",
  template: "Template",
};

export function DiscoverTab({ canWrite }: { canWrite: boolean }) {
  const tt = useTranslations();
  const [state, run, pending] = useActionState<DiscoverState>(discoverAction, { ok: false });
  const result = state.result;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <form action={run}>
          <button type="submit" className="btn-primary" disabled={pending}>
            {tt(pending ? "Discovering…" : result ? "Run again" : "Run discovery")}
          </button>
        </form>
        <p className="text-xs text-gray-500">{tt("Finds new prompts from Search Console demand, competitor gaps in AI answers, and your site.")}</p>
      </div>
      {state.error ? <p role="alert" className="text-sm text-red-600">{tt(state.error)}</p> : null}
      {result?.notes.length ? (
        <ul className="space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
          {result.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      ) : null}
      {result && result.candidates.length === 0 ? <p className="text-sm text-gray-400">{tt("No new prompt ideas right now.")}</p> : null}
      {result && result.candidates.length > 0 ? (
        <ActionForm action={trackCandidatesAction} submitLabel={tt("Track selected prompts")} className="space-y-2">
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-8">
                    <span className="sr-only">{tt("Select")}</span>
                  </th>
                  <th>{tt("Prompt idea")}</th>
                  <th>{tt("Source")}</th>
                  <th>{tt("Signal")}</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((c) => (
                  <tr key={`${c.source}-${c.text}`}>
                    <td>
                      <input type="checkbox" name="candidate" value={`${c.source}|${c.volume}|${c.text}`} disabled={!canWrite} aria-label={tt("Track {0}", { 0: c.text })} />
                    </td>
                    <td>{c.text}</td>
                    <td>
                      <span className="badge bg-gray-100 text-gray-600">{tt(LABEL[c.source] ?? c.source)}</span>
                    </td>
                    <td className="text-xs text-gray-500">
                      {tt(c.source === "search_console" ? `${c.volume.toLocaleString()} impressions` : c.source === "competitor_gap" ? `${c.volume} answers without you` : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
