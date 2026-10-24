import { getTranslations } from "@/lib/i18n/server";
import type { CompetitorCandidate } from "@athena/core/competitors";
import { ActionForm } from "@/components/action-form";
import { addCompetitorAction } from "../actions";

async function CandidateList({ candidates, canWrite }: { candidates: CompetitorCandidate[]; canWrite: boolean }) {
  const tt = await getTranslations();
  return (
    <ul className="space-y-2">
      {candidates.map((cand) => (
        <li key={cand.name} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-28 font-medium text-gray-800">{cand.name}</span>
          <span className="text-gray-400" title={tt("e.g. “{0}”", { 0: cand.samplePrompt })}>
            {tt("in ")}{cand.responses} {tt(" answers")}</span>
          {canWrite ? (
            <ActionForm action={addCompetitorAction} submitLabel={tt("Track")} variant="secondary" className="ml-auto flex items-center gap-2">
              <input type="hidden" name="name" value={cand.name} />
              <input name="domain" required placeholder={tt("their-domain.com")} className="input !w-36 !py-1 text-xs" aria-label={tt("Domain for {0}", { 0: cand.name })} />
            </ActionForm>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

async function SuggestionList({ suggestions, provider, canWrite }: { suggestions: { name: string; domain: string }[]; provider?: string; canWrite: boolean }) {
  const tt = await getTranslations();
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="mb-2 text-xs text-gray-500">{tt("Suggested by AI during onboarding")}{tt(provider ? ` (${provider})` : "")}</p>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.domain} className="flex items-center gap-2 text-xs">
            <span className="w-28 font-medium">{s.name}</span>
            <span className="text-gray-400">{s.domain}</span>
            {canWrite ? (
              <ActionForm action={addCompetitorAction} submitLabel={tt("Track")} variant="secondary" className="ml-auto">
                <input type="hidden" name="name" value={s.name} />
                <input type="hidden" name="domain" value={s.domain} />
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function DiscoveredCompetitors(props: { candidates: CompetitorCandidate[]; suggestions: { name: string; domain: string }[]; provider?: string; canWrite: boolean }) {
  const tt = await getTranslations();
  return (
    <section className="rounded-xl border border-gray-100 p-4">
      <h2 className="text-sm font-semibold text-gray-900">{tt("Discovered in AI answers")}</h2>
      <p className="mb-3 text-xs text-gray-500">{tt("Brands that answers list repeatedly but you don’t track yet. Confirm the domain to start tracking.")}</p>
      {props.candidates.length === 0 ? (
        <p className="text-xs text-gray-400">{tt("No untracked brands appear in at least two answers yet.")}</p>
      ) : (
        <CandidateList candidates={props.candidates} canWrite={props.canWrite} />
      )}
      {props.suggestions.length ? <SuggestionList suggestions={props.suggestions} provider={props.provider} canWrite={props.canWrite} /> : null}
    </section>
  );
}
