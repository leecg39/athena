import { PageHeader } from "@/components/page-header";
import { demoAds } from "@/lib/data";
void demoAds;

export const metadata = { title: "Site Health" };

const CHECKS = [
  { page: "/", status: "pass", detail: "200 · AI accessible · in sitemap" },
  { page: "/pricing", status: "pass", detail: "200 · AI accessible" },
  { page: "/blog/ai-design", status: "warn", detail: "robots.txt blocks ClaudeBot" },
  { page: "/old/features", status: "fail", detail: "404 · remove from sitemap" },
  { page: "/docs/api", status: "warn", detail: "llms.txt missing" },
] as const;

export default async function SiteHealthPage() {
  return (
    <div>
      <PageHeader
        title="Site Health"
        subtitle="Crawlability, AI accessibility, keywords and live-content verification"
        actions={
          <>
            <button className="btn-secondary">Staging checks</button>
            <button className="btn-primary">Crawl now</button>
          </>
        }
      />
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Pages indexed" value="1,284" />
          <Tile label="AI accessible" value="96.2%" />
          <Tile label="Keywords ranked" value="342" />
          <Tile label="Failed checks" value="1" />
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>Page</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {CHECKS.map((c) => (
                <tr key={c.page}>
                  <td className="text-brand-600">{c.page}</td>
                  <td>
                    <span
                      className={`badge ${
                        c.status === "pass" ? "bg-emerald-50 text-emerald-600" : c.status === "warn" ? "bg-orange-50 text-orange-500" : "bg-red-50 text-red-500"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="text-gray-500">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Tile(props: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="text-xs text-gray-400">{props.label}</div>
      <div className="mt-1 text-xl font-bold text-gray-900">{props.value}</div>
    </div>
  );
}
