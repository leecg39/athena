import Link from "next/link";
import { AI_CRAWLER_BOTS } from "@athena/core/site-health";

export const metadata = {
  title: "AthenaBot Crawler Documentation",
  description: "How AthenaBot verifies live content, structured data, and AI search accessibility.",
};

export default function BotPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <span className="badge bg-brand-50 text-brand-700">Crawler &amp; AEO Verification</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">AthenaBot Crawler Guide</h1>
          <p className="mt-1 text-sm text-gray-600">
            AthenaBot inspects your public pages, <code className="font-mono">/robots.txt</code>,{" "}
            <code className="font-mono">/sitemap.xml</code>, and <code className="font-mono">/llms.txt</code> to verify AI search crawlability.
          </p>
        </div>
        <Link href="/site-health" className="btn-secondary text-xs">
          ← Back to Site Health
        </Link>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Recommended robots.txt Configuration</h2>
        <p className="mt-1 text-xs text-gray-500">
          Allow AI search indexers so ChatGPT Search, Claude, Perplexity, and Google AI Mode can cite your authoritative pages:
        </p>
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
        <h2 className="text-sm font-semibold text-gray-900">Evaluated AI Search User Agents</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>User-Agent Token</th>
                <th>Provider</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {AI_CRAWLER_BOTS.map((b) => (
                <tr key={b.bot}>
                  <td className="font-mono text-xs font-semibold text-brand-700">{b.bot}</td>
                  <td className="text-xs text-gray-700">{b.owner}</td>
                  <td className="text-xs text-gray-500">{b.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
