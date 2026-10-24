import { getTranslations } from "@/lib/i18n/server";
import { eq } from "drizzle-orm";
import { db, organizations } from "@athena/db";
import { EMAIL_TEMPLATE_CATALOG, renderEmailTemplateHtml } from "@athena/emails";
import { ObservabilitySettingsView } from "@/components/observability-settings-view";
import { SettingsShell } from "@/components/settings-shell";
import { appBaseUrl } from "@/lib/email";
import { getSettingsContext } from "@/lib/settings-context";
import { getObservabilitySnapshot } from "@/lib/telemetry";
import {
  sendTestEmailTemplateAction,
  submitProductSurveyAction,
  triggerDiagnosticTraceAction,
} from "./actions";

export async function generateMetadata() {
  const tt = await getTranslations();
  return {
  title: tt("Settings — Observability, Security & Email Templates"),
};
}
export const dynamic = "force-dynamic";

export default async function ObservabilitySettingsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const snap = getObservabilitySnapshot(s.organizationId);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, s.organizationId));
  const baseUrl = await appBaseUrl();

  const emailTemplates = EMAIL_TEMPLATE_CATALOG.map((tpl) => {
    const rendered = renderEmailTemplateHtml(tpl.id, {
      brandName: s.website.name,
      orgName: org?.name ?? "",
      domain: s.website.domain,
      baseUrl,
    });
    return {
      id: tpl.id,
      name: tpl.name,
      category: tpl.category,
      description: tpl.description,
      subject: rendered.subject,
      html: rendered.html,
    };
  });

  return (
    <SettingsShell
      active="observability"
      title={tt("Observability, Telemetry & Email Templates")}
      subtitle={tt("This organization's first-party events and survey answers, PostHog and OpenTelemetry configuration, and email template previews")}
    >
      <ObservabilitySettingsView
        userEmail={s.user.email ?? ""}
        summary={snap.summary}
        events={snap.events}
        sessionReplays={snap.sessionReplays}
        surveys={snap.surveys}
        webVitals={snap.webVitals}
        otelSpans={snap.otelSpans}
        cspReports={snap.cspReports}
        emailTemplates={emailTemplates}
        submitProductSurveyAction={submitProductSurveyAction}
        triggerDiagnosticTraceAction={triggerDiagnosticTraceAction}
        sendTestEmailTemplateAction={sendTestEmailTemplateAction}
      />
    </SettingsShell>
  );
}
