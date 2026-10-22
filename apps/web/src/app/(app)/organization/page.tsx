import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Organization" };

export default async function OrganizationPage() {
  return (
    <div>
      <PageHeader title="Organization" subtitle="Org-wide overview, API access and audit trail" />
      <div className="space-y-4 p-6">
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">Demo Org</div>
          <div className="text-xs text-gray-400">Free plan · 3 members · 2 websites</div>
        </div>
        <div className="metric-card">
          <div className="mb-2 text-sm font-semibold text-gray-900">Quick links</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="badge bg-brand-50 text-brand-600" href="/settings/api">API & MCP</a>
            <a className="badge bg-gray-100 text-gray-600" href="/settings/users">Members</a>
            <a className="badge bg-gray-100 text-gray-600" href="/settings/activity">Activity log</a>
            <a className="badge bg-gray-100 text-gray-600" href="/settings/billing">Billing</a>
          </div>
        </div>
      </div>
    </div>
  );
}
