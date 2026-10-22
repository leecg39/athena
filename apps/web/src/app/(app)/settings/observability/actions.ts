"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, logActivity } from "@athena/core/org";
import {
  EMAIL_TEMPLATE_CATALOG,
  renderEmailTemplateHtml,
  type EmailTemplateId,
} from "@athena/emails";
import { runAction, type ActionState } from "@/lib/action-state";
import { appBaseUrl, sendEmail } from "@/lib/email";
import { getSettingsContext } from "@/lib/settings-context";
import {
  recordProductSurveyResponse,
  recordSessionReplaySnapshot,
  recordTelemetryEvent,
  withTracedSpan,
} from "@/lib/telemetry";

export async function submitProductSurveyAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const s = await getSettingsContext();
    const actorEmail = s.user.email ?? "demo@example.com";
    const category = String(form.get("category") ?? "nps").trim();
    const score = Number(form.get("score") ?? 9);
    const feedback = String(form.get("feedback") ?? "").trim();

    let survey;
    try {
      survey = recordProductSurveyResponse({
        surveyId: "nps_q4_2026",
        category,
        score,
        feedback,
        pagePath: "/settings/observability",
        organizationId: s.organizationId,
        userId: s.user.id,
      });
    } catch (err) {
      throw new DomainError((err as Error).message);
    }

    recordTelemetryEvent({
      event: "survey sent",
      distinctId: actorEmail,
      organizationId: s.organizationId,
      websiteId: s.websiteId,
      properties: {
        $survey_id: survey.surveyId,
        $survey_response: survey.feedback,
        $survey_score: survey.score,
        category: survey.category,
      },
    });

    await logActivity(db, {
      organizationId: s.organizationId,
      userId: s.user.id,
      websiteId: s.websiteId,
      entityType: "telemetry_survey",
      entityId: s.websiteId,
      change: "submitted",
      after: {
        surveyId: survey.surveyId,
        category: survey.category,
        score: survey.score,
        feedback: survey.feedback,
      },
    });

    revalidatePath("/settings/observability");
    revalidatePath("/settings/activity");
    return {
      ok: true,
      message: `Recorded PostHog survey response (${survey.score}/10).`,
    };
  });
}

export async function triggerDiagnosticTraceAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const s = await getSettingsContext();
    const actorEmail = s.user.email ?? "demo@example.com";
    const operationName =
      String(form.get("operationName") ?? "athena.diagnostics.pipelineCheck").trim() ||
      "athena.diagnostics.pipelineCheck";

    await withTracedSpan(
      operationName,
      {
        "athena.organization_id": s.organizationId,
        "athena.website_id": s.websiteId,
        "athena.actor_email": actorEmail,
      },
      async () => {
        recordSessionReplaySnapshot({
          distinctId: actorEmail,
          pagePath: "/settings/observability",
          durationSec: 95,
          eventsCount: 24,
        });
        recordTelemetryEvent({
          event: "diagnostic_trace_executed",
          distinctId: actorEmail,
          organizationId: s.organizationId,
          websiteId: s.websiteId,
          properties: { operationName, status: "OK" },
        });
      },
    );

    await logActivity(db, {
      organizationId: s.organizationId,
      userId: s.user.id,
      websiteId: s.websiteId,
      entityType: "otel_trace",
      entityId: s.websiteId,
      change: "recorded",
      after: { operationName, serviceName: "@athena/web" },
    });

    revalidatePath("/settings/observability");
    revalidatePath("/settings/activity");
    return {
      ok: true,
      message: `Recorded OpenTelemetry span "${operationName}" and session replay snapshot.`,
    };
  });
}

export async function sendTestEmailTemplateAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const s = await getSettingsContext();
    const actorEmail = s.user.email ?? "demo@example.com";
    const templateIdRaw = String(form.get("templateId") ?? "weekly_report").trim();
    const recipient = String(form.get("recipient") ?? actorEmail).trim() || actorEmail;

    const validIds = EMAIL_TEMPLATE_CATALOG.map((t) => t.id);
    if (!validIds.includes(templateIdRaw as EmailTemplateId)) {
      throw new DomainError("Invalid email template selected.");
    }
    const templateId = templateIdRaw as EmailTemplateId;
    const baseUrl = await appBaseUrl();
    const rendered = renderEmailTemplateHtml(templateId, {
      brandName: s.website.name,
      orgName: "Canvasly Workspace",
      domain: s.website.domain,
      baseUrl,
    });

    const deliveredViaResend = await sendEmail({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
    });

    recordTelemetryEvent({
      event: "email_template_dispatched",
      distinctId: actorEmail,
      organizationId: s.organizationId,
      websiteId: s.websiteId,
      properties: {
        templateId,
        recipient,
        deliveredViaResend,
      },
    });

    await logActivity(db, {
      organizationId: s.organizationId,
      userId: s.user.id,
      websiteId: s.websiteId,
      entityType: "email_template",
      entityId: s.websiteId,
      change: "dispatched",
      after: {
        templateId,
        recipient,
        subject: rendered.subject,
        mode: deliveredViaResend ? "resend" : "local_preview",
      },
    });

    revalidatePath("/settings/observability");
    revalidatePath("/settings/activity");
    return {
      ok: true,
      message: `Dispatched "${rendered.subject}" to ${recipient} (${deliveredViaResend ? "Resend API" : "Local Preview Mode"}).`,
    };
  });
}
