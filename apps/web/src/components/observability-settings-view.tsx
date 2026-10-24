"use client";
import { useTranslations } from "@/components/locale-provider";


import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import type { ActionState } from "@/lib/action-state";
import type {
  CspViolationRecord,
  OtelSpanRecord,
  ProductSurveyRecord,
  SessionReplayRecord,
  TelemetryEventRecord,
  WebVitalRecord,
} from "@/lib/telemetry";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export interface EmailTemplatePreviewItem {
  id: string;
  name: string;
  category: string;
  description: string;
  subject: string;
  html: string;
}

export function ObservabilitySettingsView(props: {
  userEmail: string;
  summary: {
    eventsCount: number;
    sessionReplaysCount: number;
    surveysCount: number;
    avgSurveyScore: number | null;
    otelSpansCount: number;
    cspReportsCount: number;
    posthogConfigured: boolean;
    otelCollectorConfigured: boolean;
    vercelAnalyticsEnabled: boolean;
    speedInsightsEnabled: boolean;
  };
  events: TelemetryEventRecord[];
  sessionReplays: SessionReplayRecord[];
  surveys: ProductSurveyRecord[];
  webVitals: WebVitalRecord[];
  otelSpans: OtelSpanRecord[];
  cspReports: CspViolationRecord[];
  emailTemplates: EmailTemplatePreviewItem[];
  submitProductSurveyAction: ServerAction;
  triggerDiagnosticTraceAction: ServerAction;
  sendTestEmailTemplateAction: ServerAction;
}) {
  const tt = useTranslations();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    props.emailTemplates[0]?.id ?? "weekly_report",
  );
  const selectedTemplate =
    props.emailTemplates.find((t) => t.id === selectedTemplateId) ?? props.emailTemplates[0];

  return (
    <div className="space-y-6">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="metric-card">
          <div className="text-xs text-gray-500">{tt("First-party events / heartbeats")}</div>
          <div className="mt-1 text-xl font-bold text-gray-900" data-testid="obs-events-count">
            {props.summary.eventsCount} / {props.summary.sessionReplaysCount}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">{tt(props.summary.posthogConfigured ? "PostHog is also configured" : "PostHog key not set")}</div>
        </div>
        <div className="metric-card">
          <div className="text-xs text-gray-500">{tt("Product Survey NPS")}</div>
          <div className="mt-1 text-xl font-bold text-brand-700" data-testid="obs-survey-nps">
            {props.summary.avgSurveyScore === null ? "—" : `${props.summary.avgSurveyScore.toFixed(1)} / 10`}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            {props.summary.surveysCount} {tt(" survey responses")}</div>
        </div>
        <div className="metric-card">
          <div className="text-xs text-gray-500">{tt("OpenTelemetry export")}</div>
          <div className="mt-1 text-xl font-bold text-gray-900" data-testid="obs-otel-count">
            {tt(props.summary.otelCollectorConfigured ? "Configured" : "Not configured")}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">{tt("Traces are platform data, not shown per workspace")}</div>
        </div>
        <div className="metric-card">
          <div className="text-xs text-gray-500">{tt("CSP Security Reports")}</div>
          <div className="mt-1 text-xl font-bold text-gray-900" data-testid="obs-csp-count">
            {tt("Collected")}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">{tt("At /api/csp-report for the platform (query strings removed)")}</div>
        </div>
      </div>

      {/* Section 1: PostHog Events, Masked Session Replays & In-App Survey */}
      <section className="metric-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {tt("Product telemetry for this organization")}</h2>
            <p className="text-xs text-gray-500">
              {tt("Automatic PII/Secret key redaction (")}<code className="font-mono">[REDACTED]</code>{tt(") and")}{tt(" ")}
              <code className="font-mono">maskAllInputs: true</code> {tt(" on all recorded sessions.")}</p>
          </div>
          <span className="badge bg-gray-100 text-xs text-gray-600">
            {tt("Kept in server memory (resets on restart)")}</span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="mb-2 text-xs font-semibold text-gray-800">{tt("Recent first-party events")}</div>
            <div className="space-y-1.5">
              {props.events.slice(0, 5).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs"
                >
                  <div>
                    <span className="font-mono font-medium text-gray-900">{e.event}</span>
                    <span className="ml-2 text-gray-500">{e.distinctId}</span>
                  </div>
                  <span className="font-mono text-[11px] text-gray-400">
                    {e.recordedAt.slice(11, 19)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-3">
            <div className="mb-2 text-xs font-semibold text-gray-800">
              {tt("Send product feedback")}</div>
            <ActionForm
              action={props.submitProductSurveyAction}
              submitLabel={tt("Submit Survey Feedback")}
              className="space-y-2.5"
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600">{tt("Category")}</label>
                  <select name="category" className="input-base mt-1 text-xs" defaultValue="nps">
                    <option value="nps">{tt("NPS Score (0-10)")}</option>
                    <option value="feature_request">{tt("Feature Request")}</option>
                    <option value="ux_feedback">{tt("UX / Workflow")}</option>
                    <option value="data_accuracy">{tt("AI Citation Accuracy")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-600">
                    {tt("Score (0–10)")}</label>
                  <input
                    name="score"
                    type="number"
                    min={0}
                    max={10}
                    defaultValue={10}
                    className="input-base mt-1 text-xs"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600">{tt("Feedback")}</label>
                <input
                  name="feedback"
                  className="input-base mt-1 text-xs"
                  placeholder={tt("Share product feedback on Athenum AI visibility & MCP...")}
                  required
                  minLength={3}
                  maxLength={500}
                />
              </div>
            </ActionForm>
          </div>
        </div>
      </section>

      {/* Section 2: Vercel Analytics, Speed Insights & OpenTelemetry Tracing */}
      <section className="metric-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {tt("OpenTelemetry tracing")}
            </h2>
            <p className="text-xs text-gray-500">
              {tt("Spans are exported to OTEL_EXPORTER_OTLP_ENDPOINT when it is set; they are platform data and are not listed here.")}
            </p>
          </div>
          <ActionForm
            action={props.triggerDiagnosticTraceAction}
            submitLabel={tt("Run Diagnostic OTel Span")}
            variant="secondary"
            className="flex items-center gap-2"
          >
            <input
              type="hidden"
              name="operationName"
              value="athena.diagnostics.e2eHealthCheck"
            />
          </ActionForm>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {props.webVitals.slice(0, 4).map((w) => (
            <div key={w.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-gray-800">{w.name}</span>
                <span className="badge bg-emerald-50 text-[10px] text-emerald-700">
                  {tt(w.rating)}
                </span>
              </div>
              <div className="mt-1 font-mono text-base font-bold text-gray-900">
                {tt(w.name === "CLS" ? w.value : `${w.value}ms`)}
              </div>
              <div className="text-[11px] text-gray-400">{w.pagePath}</div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>{tt("Trace ID")}</th>
                <th>{tt("Service")}</th>
                <th>{tt("Span Name")}</th>
                <th>{tt("Duration")}</th>
                <th>{tt("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {props.otelSpans.slice(0, 6).map((sp) => (
                <tr key={`${sp.traceId}-${sp.spanId}`}>
                  <td className="font-mono text-xs text-gray-500">{sp.traceId.slice(0, 12)}…</td>
                  <td>
                    <span className="badge bg-brand-50 font-mono text-xs text-brand-700">
                      {sp.serviceName}
                    </span>
                  </td>
                  <td className="font-mono text-xs font-medium text-gray-900">{sp.name}</td>
                  <td className="font-mono text-xs text-gray-600">{sp.durationMs}{tt("ms")}</td>
                  <td>
                    <span
                      className={`badge text-xs ${
                        sp.status === "OK"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {tt(sp.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: Transactional React Email Templates Preview & Dispatch */}
      <section className="metric-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {tt("React Email Templates (")}<code className="font-mono">@athena/emails</code>)
            </h2>
            <p className="text-xs text-gray-500">
              {tt("Preview transactional emails. A test send goes only to your own address, and only when email delivery is configured.")}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {props.emailTemplates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setSelectedTemplateId(tpl.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  selectedTemplateId === tpl.id
                    ? "bg-brand-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tt(tpl.category)}
              </button>
            ))}
          </div>
        </div>

        {selectedTemplate ? (
          <div className="space-y-3 rounded-xl border border-gray-100 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
              <div>
                <div className="text-xs font-semibold text-gray-900">{tt(selectedTemplate.name)}</div>
                <div className="font-mono text-xs text-gray-500">
                  {tt("Subject: ")}{selectedTemplate.subject}
                </div>
              </div>
              <ActionForm
                action={props.sendTestEmailTemplateAction}
                submitLabel={tt("Send Test Email")}
                className="flex items-center gap-2"
              >
                <input type="hidden" name="templateId" value={selectedTemplate.id} />
                <span className="text-xs text-gray-500">{tt("to {0}", { 0: props.userEmail })}</span>
              </ActionForm>
            </div>

            <div
              className="overflow-hidden rounded-lg border border-gray-100"
              data-testid="email-template-preview"
              dangerouslySetInnerHTML={{ __html: selectedTemplate.html }}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
