import type { WebsiteRow } from "@athena/core/tenancy";
import { ActionForm } from "@/components/action-form";
import { saveBrandStep } from "../actions";

export function BrandStep({ site }: { site: WebsiteRow }) {
  const p = site.profile ?? {};
  const access = p.aiAccess ?? [];
  const blocked = access.filter((a) => a.status === "blocked");
  return (
    <div className="space-y-8">
      <ActionForm action={saveBrandStep} submitLabel="Save and continue" className="space-y-4">
        <input type="hidden" name="websiteId" value={site.id} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Brand name</span>
          <input name="name" className="input" defaultValue={site.name} required maxLength={120} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">What does {site.domain} do?</span>
          <textarea name="description" className="input" rows={3} defaultValue={p.description ?? ""} maxLength={600} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Products or services (comma separated)</span>
          <input name="products" className="input" defaultValue={(p.products ?? []).join(", ")} placeholder="e.g. Hosting, AI SDK" />
        </label>
      </ActionForm>

      <section>
        <h2 className="text-sm font-semibold text-gray-900">AI crawler access</h2>
        {access.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">We could not read this site’s robots.txt yet. You can re-check it later in Site Health.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-gray-500">
              {blocked.length
                ? `${blocked.length} AI crawler(s) are blocked by robots.txt — those assistants may not be able to read or cite your pages.`
                : "robots.txt allows the major AI crawlers to read your homepage."}
            </p>
            <table className="table-base mt-3">
              <thead>
                <tr>
                  <th>Crawler</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Rule</th>
                </tr>
              </thead>
              <tbody>
                {access.map((a) => (
                  <tr key={a.bot}>
                    <td className="font-mono text-xs">{a.bot}</td>
                    <td className="text-xs text-gray-500">{a.owner}</td>
                    <td>
                      <span className={`badge ${a.status === "blocked" ? "bg-red-50 text-red-700" : a.status === "allowed" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="text-xs text-gray-400">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
