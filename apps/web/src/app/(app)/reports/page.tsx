import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { db } from "@athena/db";
import { getSlackConnection, listScheduledReports } from "@athena/core/reports";
import { PageHeader } from "@/components/page-header";
import { ReportBuilderView } from "@/components/report-builder-view";
import { getSettingsContext } from "@/lib/settings-context";
import { emailDeliveryConfigured } from "@/lib/report-transport";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Reports") };
}

export default async function ReportsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const c = { actorId: s.user.id, websiteId: s.websiteId };
  const [reports, slack] = await Promise.all([listScheduledReports(db, c), getSlackConnection(db, c)]);
  const canWrite = s.membership.permissions.includes("content:write");
  const emailReady = emailDeliveryConfigured();
  const sent = reports.filter((r) => r.lastSentAt).length;

  return (
    <div>
      <PageHeader
        title={tt("Reports")}
        subtitle={tt("Compose reports from your collected AI answers, send them by email or Slack on a schedule, export a PDF or share a read-only link")}
      />
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Scheduled Reports")}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{reports.length}</div>
            <div className="mt-1 text-xs text-gray-500">{tt("{0} sent at least once", { 0: sent })}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Email delivery")}</div>
            <div className={`mt-1 text-lg font-bold ${emailReady ? "text-emerald-700" : "text-gray-500"}`}>{tt(emailReady ? "Configured" : "Not configured")}</div>
            <div className="mt-1 text-xs text-gray-500">{tt(emailReady ? "Sent through Resend" : "Set RESEND_API_KEY and EMAIL_FROM on the server")}</div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Slack")}</div>
            <div className={`mt-1 text-lg font-bold ${slack.connected ? "text-emerald-700" : "text-gray-500"}`}>{tt(slack.connected ? "Connected" : "Not connected")}</div>
            <div className="mt-1 text-xs text-gray-500">
              {slack.connected ? (slack.channel ?? tt("Incoming webhook")) : <Link href="/settings/integrations" className="text-brand-600 underline">{tt("Connect a Slack webhook")}</Link>}
            </div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-400">{tt("Public Share Links")}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{reports.length}</div>
            <div className="mt-1 text-xs text-gray-500">{tt("Read-only links without recipients or internal data")}</div>
          </div>
        </div>

        <ReportBuilderView reports={reports} canWrite={canWrite} />
      </div>
    </div>
  );
}
