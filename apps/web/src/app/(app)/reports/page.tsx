import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { listScheduledReports } from "@athena/core/reports";
import { PageHeader } from "@/components/page-header";
import { ReportBuilderView } from "@/components/report-builder-view";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Reports") };
}

export default async function ReportsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const reports = await listScheduledReports(db, s.websiteId);
  const canWrite = s.membership.permissions.includes("content:write");

  const totalRecipients = new Set(reports.flatMap((r) => r.recipients)).size;
  const slackChannelsCount = new Set(
    reports.map((r) => r.slackChannel).filter((c): c is string => Boolean(c)),
  ).size;
  const totalChartsSelected = reports.reduce((a, r) => a + r.charts.length, 0);

  return (
    <div>
      <PageHeader
        title={tt("Reports")}
        subtitle={tt("Build custom chart compositions, schedule Email & Slack weekly digests, export PDF decks, and publish AI Search or Content Proposal share links")}
      />
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Scheduled Reports")}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{reports.length}</div>
            <div className="mt-1 text-xs text-gray-500">
              {reports.filter((r) => r.reportType === "ai_search").length} {tt(" AI Search ·")}{tt(" ")}
              {reports.filter((r) => r.reportType === "content_proposal").length} {tt(" Content Proposal")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Active Chart Modules")}</div>
            <div className="mt-1 text-2xl font-bold text-brand-700">{totalChartsSelected}</div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("Composed across ")}{reports.length} {tt(" active report templates")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Email & Slack Delivery")}</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">
              {totalRecipients} {tt(" emails · ")}{slackChannelsCount} {tt(" Slack")}</div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("Automated weekly & monthly digests")}</div>
          </div>

          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Public Share Links")}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{reports.length}</div>
            <div className="mt-1 text-xs text-gray-500">
              {tt("PII-free read-only links + PDF export")}</div>
          </div>
        </div>

        <ReportBuilderView
          reports={reports}
          siteDomain={s.website.domain}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
