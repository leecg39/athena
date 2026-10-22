import { NextRequest, NextResponse } from "next/server";
import { db } from "@athena/db";
import { logActivity } from "@athena/core/org";
import { getUser } from "@/lib/session";
import { getWorkspace } from "@/lib/workspace";
import {
  getObservabilitySnapshot,
  recordProductSurveyResponse,
  recordSessionReplaySnapshot,
  recordTelemetryEvent,
  recordWebVitalMetric,
} from "@/lib/telemetry";

/**
 * GET /api/telemetry
 * Returns current PostHog events, session replays, surveys, Web Vitals, OTel spans, and CSP reports.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ data: getObservabilitySnapshot() });
}

/**
 * POST /api/telemetry
 * First-party telemetry ingestion endpoint for PostHog events, input-masked session replays,
 * product NPS/CSAT surveys, and Vercel Speed Insights / Web Vitals metrics.
 */
export async function POST(req: NextRequest) {
  let body: {
    kind?: "event" | "session_replay" | "survey" | "web_vital";
    event?: string;
    distinctId?: string;
    properties?: Record<string, unknown>;
    sessionId?: string;
    pagePath?: string;
    durationSec?: number;
    eventsCount?: number;
    surveyId?: string;
    category?: string;
    score?: number;
    feedback?: string;
    name?: string;
    value?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ws = await getWorkspace().catch(() => null);
  const kind = body.kind ?? "event";

  try {
    if (kind === "session_replay") {
      const replay = recordSessionReplaySnapshot({
        sessionId: body.sessionId,
        distinctId: ws?.user.email ?? body.distinctId,
        pagePath: body.pagePath,
        durationSec: body.durationSec,
        eventsCount: body.eventsCount,
      });
      return NextResponse.json({ ok: true, data: replay }, { status: 201 });
    }

    if (kind === "survey") {
      const survey = recordProductSurveyResponse({
        surveyId: body.surveyId,
        category: body.category,
        score: Number(body.score),
        feedback: String(body.feedback ?? ""),
        pagePath: body.pagePath,
        organizationId: ws?.organizationId ?? null,
        userId: ws?.user.id ?? null,
      });
      if (ws) {
        await logActivity(db, {
          organizationId: ws.organizationId,
          userId: ws.user.id,
          websiteId: ws.websiteId,
          entityType: "telemetry_survey",
          entityId: ws.websiteId,
          change: "submitted",
          after: {
            surveyId: survey.surveyId,
            category: survey.category,
            score: survey.score,
            feedback: survey.feedback,
          },
        }).catch(() => undefined);
      }
      return NextResponse.json({ ok: true, data: survey }, { status: 201 });
    }

    if (kind === "web_vital") {
      const vital = recordWebVitalMetric({
        name: String(body.name ?? "LCP"),
        value: Number(body.value ?? 0),
        pagePath: body.pagePath,
      });
      return NextResponse.json({ ok: true, data: vital }, { status: 201 });
    }

    const evt = recordTelemetryEvent({
      event: String(body.event ?? ""),
      distinctId: ws?.user.email ?? body.distinctId,
      organizationId: ws?.organizationId ?? null,
      websiteId: ws?.websiteId ?? null,
      properties: body.properties,
    });
    return NextResponse.json({ ok: true, data: evt }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
