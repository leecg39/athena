import { getTranslations } from "@/lib/i18n/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, prompts, organizations } from "@athena/db";
import { PROMPT_LIMITS } from "@athena/core/onboarding";
import type { WebsiteRow } from "@athena/core/tenancy";
import { ActionForm } from "@/components/action-form";
import { getCompetitorList } from "@/lib/data";
import { promptSuggestions } from "@/lib/onboarding-suggestions";
import { savePromptStep } from "../actions";
import { SourceNote } from "./frame";

export async function PromptsStep({ site }: { site: WebsiteRow }) {
  const tt = await getTranslations();
  const [comps, tracked, [org]] = await Promise.all([
    getCompetitorList(site.id),
    db.select({ text: prompts.text }).from(prompts).where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt))),
    db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, site.organizationId)),
  ]);
  const have = new Set(tracked.map((t) => t.text.toLowerCase()));
  const suggestions = await promptSuggestions(site, comps);
  const limit = PROMPT_LIMITS[org?.plan ?? "free"];
  return (
    <ActionForm action={savePromptStep} submitLabel={tt("Save and continue")} className="space-y-5">
      <input type="hidden" name="websiteId" value={site.id} />
      <div className="flex items-center justify-between">
        <SourceNote source={suggestions.source} provider={suggestions.provider} />
        <span className="text-xs text-gray-400">
          {tracked.length}/{limit} {tt(" prompts tracked on your plan")}</span>
      </div>
      {suggestions.data.map((topic) => {
        const items = topic.prompts.filter((p) => !have.has(p.toLowerCase()));
        if (!items.length) return null;
        return (
          <fieldset key={topic.name} className="rounded-xl border border-gray-100 p-3">
            <legend className="px-1 text-xs font-semibold text-gray-700">{topic.name}</legend>
            <div className="space-y-1">
              {items.map((p) => (
                <label key={p} className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" name="suggested" value={`${topic.name}::${p}`} defaultChecked className="mt-1" />
                  {p}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <div className="grid gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Your own prompts — topic")}</span>
          <input name="manualTopic" className="input" placeholder={tt("e.g. Pricing questions")} maxLength={80} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">{tt("One prompt per line, phrased the way buyers ask AI assistants")}</span>
          <textarea name="manual" className="input" rows={4} placeholder={tt("which tools help product teams prototype faster?\nis there a free alternative to …")} />
        </label>
      </div>
      <p className="text-xs text-gray-400">{tt("Each prompt is asked to every AI model you track; one answer costs one credit.")}</p>
    </ActionForm>
  );
}
