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

export const metadata = {
  title: "Settings — Observability, Security & Email Templates",
};
export const dynamic = "force-dynamic";

export default async function ObservabilitySettingsPage() {
  const s = await getSettingsContext();
  const snap = getObservabilitySnapshot();
  const baseUrl = await appBaseUrl();

  const emailTemplates = EMAIL_TEMPLATE_CATALOG.map((tpl) => {
    const rendered = renderEmailTemplateHtml(tpl.id, {
      brandName: s.website.name,
      orgName: "Canvasly Workspace",
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
      title="Observability, Telemetry & Email Templates"
      subtitle="PostHog events/replays/surveys, Vercel Speed Insights, OpenTelemetry traces, CSP reports, and React Email templates"
    >
      <ObservabilitySettingsView
        userEmail={s.user.email ?? "demo@example.com"}
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
