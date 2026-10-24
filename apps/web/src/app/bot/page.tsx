import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { AI_CRAWLER_BOTS } from "@athena/core/site-health";

export async function generateMetadata() {
  const tt = await getTranslations();
  return {
  title: tt("AthenaBot Crawler Documentation"),
  description: tt("How AthenaBot verifies live content, structured data, and AI search accessibility."),
};
}

export default async function BotPage() {
  const tt = await getTranslations();
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <span className="badge bg-brand-50 text-brand-700">{tt("Crawler & AEO Verification")}</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{tt("AthenaBot Crawler Guide")}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {tt("AthenaBot inspects your public pages, ")}<code className="font-mono">/robots.txt</code>,{tt(" ")}
            <code className="font-mono">/sitemap.xml</code>{tt(", and ")}<code className="font-mono">/llms.txt</code> {tt(" to verify AI search crawlability.")}</p>
        </div>
        <Link href="/site-health" className="btn-secondary text-xs">
          {tt("← Back to Site Health")}</Link>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">{tt("Recommended robots.txt Configuration")}</h2>
        <p className="mt-1 text-xs text-gray-500">
          {tt("Allow AI search indexers so ChatGPT Search, Claude, Perplexity, and Google AI Mode can cite your authoritative pages:")}</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-900 p-4 font-mono text-xs text-gray-100">
{`User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: AthenaBot
Allow: /`}
        </pre>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">{tt("Evaluated AI Search User Agents")}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{tt("User-Agent Token")}</th>
                <th>{tt("Provider")}</th>
                <th>{tt("Purpose")}</th>
              </tr>
            </thead>
            <tbody>
              {AI_CRAWLER_BOTS.map((b) => (
                <tr key={b.bot}>
                  <td className="font-mono text-xs font-semibold text-brand-700">{b.bot}</td>
                  <td className="text-xs text-gray-700">{b.owner}</td>
                  <td className="text-xs text-gray-500">{tt(b.purpose)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
