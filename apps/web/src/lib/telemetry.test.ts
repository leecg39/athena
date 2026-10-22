import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_TEMPLATE_CATALOG,
  renderEmailTemplateHtml,
  safeEmailHref,
} from "@athena/emails";
import {
  getObservabilitySnapshot,
  MAX_CSP_BODY_BYTES,
  MAX_OTEL_BODY_BYTES,
  parseAndRecordCspReport,
  parseAndRecordOtelTraces,
  recordProductSurveyResponse,
  recordSessionReplaySnapshot,
  recordTelemetryEvent,
  resetObservabilityStore,
  sanitizeCspUri,
  validateOtlpCollectorEndpoint,
} from "./telemetry";
import { POST as postCspReport } from "@/app/api/csp-report/route";
import { POST as postOtelTraces } from "@/app/api/otel/traces/route";

vi.mock("@/lib/session", () => ({
  getUser: vi.fn(async () => ({
    id: "11111111-1111-4000-8000-111111111111",
    email: "demo@example.com",
    name: "Demo User",
  })),
}));

describe("Observability, Telemetry, OTel, CSP & Email Templates (Task 22)", () => {
  beforeEach(() => {
    resetObservabilityStore(true);
  });

  it("redacts secrets/tokens/API keys from PostHog events and enforces masked session replays", () => {
    const evt = recordTelemetryEvent({
      event: "api_key_created",
      distinctId: "demo@example.com",
      properties: {
        keyName: "Production Key",
        apiKey: "ath_supersecretkey123",
        customField: "ath_inline_token_999",
        nested: {
          authorization: "Bearer secret",
          safeField: "visible",
        },
      },
    });

    expect(evt.properties.keyName).toBe("Production Key");
    expect(evt.properties.apiKey).toBe("[REDACTED]");
    expect(evt.properties.customField).toBe("[REDACTED_API_KEY]");
    expect((evt.properties.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect((evt.properties.nested as Record<string, unknown>).safeField).toBe("visible");

    const replay = recordSessionReplaySnapshot({
      distinctId: "demo@example.com",
      pagePath: "/settings/api?token=secret123#hash",
      durationSec: 120,
      eventsCount: 45,
    });
    expect(replay.maskedInputs).toBe(true);
    expect(replay.pagePath).toBe("/settings/api");

    const survey = recordProductSurveyResponse({
      category: "nps",
      score: 10,
      feedback: "Great MCP integration and Looker Studio connector!",
      pagePath: "/settings/observability",
    });
    expect(survey.score).toBe(10);
    expect(() =>
      recordProductSurveyResponse({
        score: 15,
        feedback: "Invalid score",
      }),
    ).toThrow(/between 0 and 10/);
  });

  it("parses OTLP traces, enforces 256KB payload limit, and blocks SSRF collector endpoints", async () => {
    expect(validateOtlpCollectorEndpoint("https://otel.collector.example.com/v1/traces")).toBe(
      "https://otel.collector.example.com/v1/traces",
    );
    expect(validateOtlpCollectorEndpoint("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(validateOtlpCollectorEndpoint("http://metadata.google.internal/v1")).toBeNull();
    expect(validateOtlpCollectorEndpoint("javascript:alert(1)")).toBeNull();

    const otlpPayload = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "@athena/jobs" } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                  spanId: "00f067aa0ba902b7",
                  name: "collection.executePrompt",
                  startTimeUnixNano: 1_000_000_000,
                  endTimeUnixNano: 1_250_000_000,
                  status: { code: 1 },
                  attributes: [
                    { key: "athena.model", value: { stringValue: "gpt-4o" } },
                    { key: "api_key", value: { stringValue: "ath_secret" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const parsed = parseAndRecordOtelTraces(otlpPayload, "application/json");
    expect(parsed.spansRecorded).toBe(1);
    expect(parsed.spans[0]?.serviceName).toBe("@athena/jobs");
    expect(parsed.spans[0]?.durationMs).toBe(250);
    expect(parsed.spans[0]?.attributes["athena.model"]).toBe("gpt-4o");
    expect(parsed.spans[0]?.attributes.api_key).toBe("[REDACTED]");

    // Oversized OTLP payload -> 413
    const hugeBody = "x".repeat(MAX_OTEL_BODY_BYTES + 100);
    const res413 = await postOtelTraces(
      new NextRequest("http://localhost:3000/api/otel/traces", {
        method: "POST",
        body: hugeBody,
      }),
    );
    expect(res413.status).toBe(413);
  });

  it("parses CSP violation reports, strips query tokens from URIs, and rejects >32KB payloads", async () => {
    expect(sanitizeCspUri("https://app.athenum.ai/reset?token=secret_jwt#frag")).toBe(
      "https://app.athenum.ai/reset",
    );

    const cspPayload = JSON.stringify({
      "csp-report": {
        "document-uri": "https://app.athenum.ai/settings/api?secret=ath_12345",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src",
        "blocked-uri": "https://evil.example.com/inject.js?session=abc",
        "source-file": "https://app.athenum.ai/main.js?token=xyz",
        "line-number": 42,
        disposition: "enforce",
      },
    });

    const records = parseAndRecordCspReport(cspPayload, "Mozilla/5.0 Test");
    expect(records.length).toBe(1);
    expect(records[0]?.documentUri).toBe("https://app.athenum.ai/settings/api");
    expect(records[0]?.blockedUri).toBe("https://evil.example.com/inject.js");
    expect(records[0]?.sourceFile).toBe("https://app.athenum.ai/main.js");
    expect(records[0]?.effectiveDirective).toBe("script-src");

    const snap = getObservabilitySnapshot();
    expect(snap.cspReports.length).toBe(1);

    // Oversized CSP report -> 413
    const hugeCsp = "a".repeat(MAX_CSP_BODY_BYTES + 100);
    const res413 = await postCspReport(
      new NextRequest("http://localhost:3000/api/csp-report", {
        method: "POST",
        body: hugeCsp,
      }),
    );
    expect(res413.status).toBe(413);
  });

  it("renders all 5 React Email templates safely and blocks javascript:/data: CTA URLs", () => {
    expect(safeEmailHref("javascript:alert(1)")).toBe("https://athenum.ai");
    expect(safeEmailHref("data:text/html,<script>alert(1)</script>")).toBe("https://athenum.ai");
    expect(safeEmailHref("https://app.athenum.ai/olympus")).toBe("https://app.athenum.ai/olympus");

    expect(EMAIL_TEMPLATE_CATALOG.length).toBe(5);
    for (const tpl of EMAIL_TEMPLATE_CATALOG) {
      const rendered = renderEmailTemplateHtml(tpl.id, {
        brandName: 'Canvasly <script>alert("xss")</script>',
        orgName: 'Canvasly Org <script>alert("xss")</script>',
        domain: "canvasly.io",
        baseUrl: "http://localhost:3000",
      });
      expect(rendered.subject.length).toBeGreaterThan(5);
      expect(rendered.html).not.toContain("<script>");
      expect(rendered.html).toContain("&lt;script&gt;");
    }
  });
});
