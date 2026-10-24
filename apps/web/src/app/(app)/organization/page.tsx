import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db, organizations, orgMembers } from "@athena/db";
import { PageHeader } from "@/components/page-header";
import { getSettingsContext } from "@/lib/settings-context";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Organization") };
}

export default async function OrganizationPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const [[org], [members]] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, s.organizationId)),
    db.select({ n: sql<number>`count(*)::int` }).from(orgMembers).where(eq(orgMembers.organizationId, s.organizationId)),
  ]);
  const sites = s.sites.filter((w) => w.organizationId === s.organizationId);
  return (
    <div>
      <PageHeader title={tt("Organization")} subtitle={tt("Org-wide overview and administration")} />
      <div className="space-y-4 p-6">
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">{org?.name}</div>
          <div className="text-xs text-gray-400">
            {tt(org?.plan)} {tt(" plan · ")}{members?.n ?? 0} {tt(" members · ")}{sites.length} {tt(" websites visible to you · your role: ")}{tt(s.membership.role)}
          </div>
        </div>
        <div className="metric-card">
          <div className="mb-2 text-sm font-semibold text-gray-900">{tt("Administration")}</div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link className="badge bg-brand-50 text-brand-600" href="/settings/api">{tt("API & MCP")}</Link>
            <Link className="badge bg-gray-100 text-gray-600" href="/settings/users">{tt("Members")}</Link>
            <Link className="badge bg-gray-100 text-gray-600" href="/settings/activity">{tt("Activity log")}</Link>
            <Link className="badge bg-gray-100 text-gray-600" href="/settings/billing">{tt("Billing")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
