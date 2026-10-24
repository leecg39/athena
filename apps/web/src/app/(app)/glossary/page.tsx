import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/page-header";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Glossary") };
}

const TERMS: [string, string][] = [
  ["Mention Rate", "The percentage of sampled AI responses that mention your brand. Absolute basis: all responses; relative basis: responses mentioning at least one tracked brand."],
  ["Citation Rate", "The percentage of AI responses that cite your brand or domain as a source."],
  ["Share of Voice (SOV)", "Your brand's mentions as a share of all tracked-brand mentions (you + competitors) in the period."],
  ["Position", "Average 1-based rank of your brand among entities mentioned in an answer. Lower is better."],
  ["Attributed Citation", "A citation where AI explicitly attributes your content as the source of a claim."],
  ["AI Search Value", "Estimated dollar value of your AI search presence: responses influenced × value per response."],
  ["Prompt Type", "Branded prompts include your brand name; non-branded prompts are category/discovery queries."],
  ["Source Type", "C = community, T = third-party, O = owned, P = partner/press."],
  ["Knowledge Base Pillar", "A topic grouping verified brand facts used to ground content generation and accuracy checks."],
  ["Oracle Finding", "A detected conflict between an AI response and your knowledge base: confirmed inaccuracy, KB inconsistency, or model disagreement."],
  ["Response Streaming", "A scheduled or on-demand run collecting fresh AI responses for tracked prompts; 1 credit per response."],
  ["Credit", "Unit consumed per AI response collected (1 credit = 1 response)."],
];

export default async function GlossaryPage() {
  const tt = await getTranslations();
  return (
    <div>
      <PageHeader title={tt("Glossary")} subtitle={tt("Plain-language definitions of every metric, score and concept")} />
      <div className="max-w-3xl space-y-4 p-6">
        {TERMS.map(([term, def]) => (
          <div key={term} id={term.toLowerCase().replace(/[^a-z]+/g, "-")} className="metric-card">
            <div className="text-sm font-semibold text-brand-600">{tt(term)}</div>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">{tt(def)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
