import { getTranslations } from "@/lib/i18n/server";
import type { WebsiteRow } from "@athena/core/tenancy";
import { ActionForm } from "@/components/action-form";
import { getCompetitorList } from "@/lib/data";
import { competitorSuggestions } from "@/lib/onboarding-suggestions";
import { saveCompetitorStep, skipStep } from "../actions";
import { SourceNote } from "./frame";

export async function CompetitorsStep({ site }: { site: WebsiteRow }) {
  const tt = await getTranslations();
  const existing = await getCompetitorList(site.id);
  const known = new Set(existing.map((c) => c.domain));
  const suggestions = await competitorSuggestions(site);
  const fresh = suggestions.data.filter((c) => !known.has(c.domain));
  return (
    <div className="space-y-6">
      {existing.length ? (
        <div>
          <div className="text-xs font-medium text-gray-600">{tt("Already tracking")}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {existing.map((c) => (
              <span key={c.id} className="badge bg-gray-100 text-gray-700">
                {c.name} · {c.domain}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <ActionForm action={saveCompetitorStep} submitLabel={tt("Save and continue")} className="space-y-4">
        <input type="hidden" name="websiteId" value={site.id} />
        <SourceNote source={suggestions.source} provider={suggestions.provider} />
        {fresh.length ? (
          <fieldset className="grid gap-2 md:grid-cols-2">
            <legend className="sr-only">{tt("Suggested competitors")}</legend>
            {fresh.map((c) => (
              <label key={c.domain} className="flex items-center gap-2 rounded-lg border border-gray-100 p-2 text-sm">
                <input type="checkbox" name="suggested" value={`${c.name}|${c.domain}`} defaultChecked />
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-gray-400">{c.domain}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Add competitors (one per line: Name, domain.com)")}</span>
          <textarea name="manual" className="input font-mono text-xs" rows={4} placeholder={tt("Acme, acme.com\nglobex.com")} />
        </label>
      </ActionForm>
      <form action={skipStep}>
        <input type="hidden" name="websiteId" value={site.id} />
        <input type="hidden" name="step" value="competitors" />
        <button type="submit" className="text-xs text-gray-400 underline">{tt("Skip for now")}</button>
      </form>
    </div>
  );
}
