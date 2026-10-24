import { randomBytes } from "node:crypto";

export const MAX_OTEL_BODY_BYTES = 262_144; // 256 KB
export const MAX_CSP_BODY_BYTES = 32_768; // 32 KB
const MAX_BUFFER_ITEMS = 200;

const SENSITIVE_KEY_RE = /password|secret|token|api[_-]?key|authorization|cookie|credit[_-]?card/i;

export interface TelemetryEventRecord {
  id: string;
  event: string;
  distinctId: string;
  organizationId: string | null;
  websiteId: string | null;
  properties: Record<string, unknown>;
  recordedAt: string;
}

export interface SessionReplayRecord {
  sessionId: string;
  organizationId: string | null;
  distinctId: string;
  pagePath: string;
  maskedInputs: true;
  maskedSelectors: string[];
  durationSec: number;
  eventsCount: number;
  recordedAt: string;
}

export type SurveyCategory = "nps" | "feature_request" | "ux_feedback" | "data_accuracy";

export interface ProductSurveyRecord {
  id: string;
  surveyId: string;
  category: SurveyCategory;
  score: number;
  feedback: string;
  pagePath: string;
  organizationId: string | null;
  userId: string | null;
  recordedAt: string;
}

export type WebVitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";

export interface WebVitalRecord {
  id: string;
  name: WebVitalName;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  pagePath: string;
  recordedAt: string;
}

export interface OtelSpanRecord {
  traceId: string;
  spanId: string;
  name: string;
  serviceName: string;
  kind: "SERVER" | "CLIENT" | "INTERNAL" | "PRODUCER";
  durationMs: number;
  status: "OK" | "ERROR";
  attributes: Record<string, string | number | boolean>;
  recordedAt: string;
}

export interface CspViolationRecord {
  id: string;
  documentUri: string;
  violatedDirective: string;
  effectiveDirective: string;
  blockedUri: string;
  sourceFile: string | null;
  lineNumber: number | null;
  disposition: "enforce" | "report";
  userAgent: string | null;
  recordedAt: string;
}

interface ObservabilityStore {
  events: TelemetryEventRecord[];
  sessionReplays: SessionReplayRecord[];
  surveys: ProductSurveyRecord[];
  webVitals: WebVitalRecord[];
  otelSpans: OtelSpanRecord[];
  cspReports: CspViolationRecord[];
}

const emptyStore = (): ObservabilityStore => ({ events: [], sessionReplays: [], surveys: [], webVitals: [], otelSpans: [], cspReports: [] });

const globalStore = globalThis as unknown as { __athenaObservabilityStore?: ObservabilityStore };

function store(): ObservabilityStore {
  if (!globalStore.__athenaObservabilityStore) {
    globalStore.__athenaObservabilityStore = emptyStore();
  }
  return globalStore.__athenaObservabilityStore;
}

function pushBounded<T>(arr: T[], item: T): void {
  arr.unshift(item);
  if (arr.length > MAX_BUFFER_ITEMS) {
    arr.length = MAX_BUFFER_ITEMS;
  }
}

export function resetObservabilityStore(): void {
  globalStore.__athenaObservabilityStore = emptyStore();
}

/**
 * Redacts any property keys containing secrets/passwords/tokens/apiKeys before storing or forwarding.
 */
export function sanitizeTelemetryProperties(
  raw: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = sanitizeTelemetryProperties(value as Record<string, unknown>);
    } else if (typeof value === "string" && value.startsWith("ath_")) {
      out[key] = "[REDACTED_API_KEY]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function recordTelemetryEvent(input: {
  event: string;
  distinctId?: string;
  organizationId?: string | null;
  websiteId?: string | null;
  properties?: Record<string, unknown>;
}): TelemetryEventRecord {
  const name = String(input.event ?? "").trim().slice(0, 120);
  if (!name) {
    throw new Error("Telemetry event name is required");
  }
  const rec: TelemetryEventRecord = {
    id: `evt_${randomBytes(6).toString("hex")}`,
    event: name,
    distinctId: String(input.distinctId ?? "anonymous").trim().slice(0, 120) || "anonymous",
    organizationId: input.organizationId ?? null,
    websiteId: input.websiteId ?? null,
    properties: sanitizeTelemetryProperties(input.properties),
    recordedAt: new Date().toISOString(),
  };
  pushBounded(store().events, rec);
  return rec;
}

export function recordSessionReplaySnapshot(input: {
  sessionId?: string;
  organizationId?: string | null;
  distinctId?: string;
  pagePath?: string;
  durationSec?: number;
  eventsCount?: number;
}): SessionReplayRecord {
  const rec: SessionReplayRecord = {
    sessionId:
      String(input.sessionId ?? "").trim().slice(0, 80) ||
      `ph_sess_${randomBytes(6).toString("hex")}`,
    organizationId: input.organizationId ?? null,
    distinctId: String(input.distinctId ?? "anonymous").trim().slice(0, 120) || "anonymous",
    pagePath: sanitizeCspUri(input.pagePath || "/"),
    maskedInputs: true, // Always enforced to prevent PII/secret leakage in replays
    maskedSelectors: ["[data-ph-mask]", "input[type=password]", "code"],
    durationSec: Math.min(Math.max(Math.floor(Number(input.durationSec ?? 30) || 30), 1), 86_400),
    eventsCount: Math.min(Math.max(Math.floor(Number(input.eventsCount ?? 10) || 10), 1), 50_000),
    recordedAt: new Date().toISOString(),
  };
  pushBounded(store().sessionReplays, rec);
  return rec;
}

export function recordProductSurveyResponse(input: {
  surveyId?: string;
  category?: string;
  score: number;
  feedback: string;
  pagePath?: string;
  organizationId?: string | null;
  userId?: string | null;
}): ProductSurveyRecord {
  const score = Math.round(Number(input.score));
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error("Survey score must be an integer between 0 and 10");
  }
  const feedback = String(input.feedback ?? "").trim();
  if (feedback.length < 3 || feedback.length > 1000) {
    throw new Error("Survey feedback must be between 3 and 1000 characters");
  }
  const allowedCategories: SurveyCategory[] = [
    "nps",
    "feature_request",
    "ux_feedback",
    "data_accuracy",
  ];
  const category: SurveyCategory = allowedCategories.includes(input.category as SurveyCategory)
    ? (input.category as SurveyCategory)
    : "nps";

  const rec: ProductSurveyRecord = {
    id: `srv_${randomBytes(6).toString("hex")}`,
    surveyId: String(input.surveyId ?? "nps_q4_2026").trim().slice(0, 80) || "nps_q4_2026",
    category,
    score,
    feedback,
    pagePath: sanitizeCspUri(input.pagePath || "/home"),
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    recordedAt: new Date().toISOString(),
  };
  pushBounded(store().surveys, rec);
  return rec;
}

export function recordWebVitalMetric(input: {
  name: string;
  value: number;
  pagePath?: string;
}): WebVitalRecord {
  const allowedNames: WebVitalName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];
  const upper = String(input.name ?? "").toUpperCase() as WebVitalName;
  const name: WebVitalName = allowedNames.includes(upper) ? upper : "LCP";
  const value = Math.max(0, Number(input.value) || 0);

  let rating: WebVitalRecord["rating"] = "good";
  if (name === "LCP" && value > 2500) rating = value > 4000 ? "poor" : "needs-improvement";
  if (name === "INP" && value > 200) rating = value > 500 ? "poor" : "needs-improvement";
  if (name === "CLS" && value > 0.1) rating = value > 0.25 ? "poor" : "needs-improvement";
  if (name === "TTFB" && value > 800) rating = value > 1800 ? "poor" : "needs-improvement";

  const rec: WebVitalRecord = {
    id: `wv_${randomBytes(5).toString("hex")}`,
    name,
    value,
    rating,
    pagePath: sanitizeCspUri(input.pagePath || "/"),
    recordedAt: new Date().toISOString(),
  };
  pushBounded(store().webVitals, rec);
  return rec;
}

/**
 * Validates OTLP collector URL and blocks SSRF targets (cloud metadata / non-HTTP schemes).
 */
export function validateOtlpCollectorEndpoint(rawEndpoint: string | undefined): string | null {
  if (!rawEndpoint) return null;
  try {
    const u = new URL(rawEndpoint.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (
      host === "169.254.169.254" ||
      host === "metadata.google.internal" ||
      host.startsWith("169.254.") ||
      host === "0.0.0.0"
    ) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function parseAndRecordOtelTraces(
  rawBody: string,
  contentType = "application/json",
): { accepted: true; spansRecorded: number; spans: OtelSpanRecord[] } {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_OTEL_BODY_BYTES) {
    throw new Error("OTLP payload exceeds maximum size of 256KB");
  }

  const recorded: OtelSpanRecord[] = [];
  const now = new Date().toISOString();

  if (contentType.includes("protobuf") || !rawBody.trim().startsWith("{")) {
    const span: OtelSpanRecord = {
      traceId: randomBytes(16).toString("hex"),
      spanId: randomBytes(8).toString("hex"),
      name: "otlp.protobuf.ingest",
      serviceName: "@athena/otel-collector",
      kind: "SERVER",
      durationMs: 12,
      status: "OK",
      attributes: {
        "otlp.encoding": "protobuf",
        "otlp.bytes": Buffer.byteLength(rawBody, "utf8"),
      },
      recordedAt: now,
    };
    pushBounded(store().otelSpans, span);
    return { accepted: true, spansRecorded: 1, spans: [span] };
  }

  const parsed = JSON.parse(rawBody) as {
    spans?: Array<{
      traceId?: string;
      spanId?: string;
      name?: string;
      serviceName?: string;
      kind?: OtelSpanRecord["kind"];
      durationMs?: number;
      status?: "OK" | "ERROR";
      attributes?: Record<string, string | number | boolean>;
    }>;
    resourceSpans?: Array<{
      resource?: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> };
      scopeSpans?: Array<{
        spans?: Array<{
          traceId?: string;
          spanId?: string;
          name?: string;
          startTimeUnixNano?: string | number;
          endTimeUnixNano?: string | number;
          status?: { code?: number | string };
          attributes?: Array<{
            key: string;
            value?: { stringValue?: string; intValue?: number; boolValue?: boolean };
          }>;
        }>;
      }>;
    }>;
  };

  if (Array.isArray(parsed.spans)) {
    for (const s of parsed.spans.slice(0, 50)) {
      const span: OtelSpanRecord = {
        traceId: String(s.traceId || randomBytes(16).toString("hex")).slice(0, 32),
        spanId: String(s.spanId || randomBytes(8).toString("hex")).slice(0, 16),
        name: String(s.name || "athena.operation").slice(0, 140),
        serviceName: String(s.serviceName || "@athena/web").slice(0, 80),
        kind: s.kind && ["SERVER", "CLIENT", "INTERNAL", "PRODUCER"].includes(s.kind) ? s.kind : "SERVER",
        durationMs: Math.max(0, Math.round(Number(s.durationMs ?? 15) || 15)),
        status: s.status === "ERROR" ? "ERROR" : "OK",
        attributes: s.attributes ?? {},
        recordedAt: now,
      };
      pushBounded(store().otelSpans, span);
      recorded.push(span);
    }
  }

  if (Array.isArray(parsed.resourceSpans)) {
    for (const rs of parsed.resourceSpans.slice(0, 10)) {
      const serviceAttr = rs.resource?.attributes?.find((a) => a.key === "service.name");
      const serviceName = serviceAttr?.value?.stringValue || "@athena/web";
      for (const ss of (rs.scopeSpans ?? []).slice(0, 10)) {
        for (const sp of (ss.spans ?? []).slice(0, 50)) {
          const startNano = Number(sp.startTimeUnixNano ?? 0);
          const endNano = Number(sp.endTimeUnixNano ?? 0);
          const durationMs =
            endNano > startNano ? Math.max(1, Math.round((endNano - startNano) / 1_000_000)) : 10;
          const attrMap: Record<string, string | number | boolean> = {};
          for (const a of sp.attributes ?? []) {
            if (SENSITIVE_KEY_RE.test(a.key)) {
              attrMap[a.key] = "[REDACTED]";
            } else if (a.value?.stringValue !== undefined) {
              attrMap[a.key] = a.value.stringValue;
            } else if (a.value?.intValue !== undefined) {
              attrMap[a.key] = a.value.intValue;
            } else if (a.value?.boolValue !== undefined) {
              attrMap[a.key] = a.value.boolValue;
            }
          }
          const span: OtelSpanRecord = {
            traceId: String(sp.traceId || randomBytes(16).toString("hex")).slice(0, 32),
            spanId: String(sp.spanId || randomBytes(8).toString("hex")).slice(0, 16),
            name: String(sp.name || "otlp.span").slice(0, 140),
            serviceName,
            kind: "SERVER",
            durationMs,
            status: sp.status?.code === 2 || sp.status?.code === "ERROR" ? "ERROR" : "OK",
            attributes: attrMap,
            recordedAt: now,
          };
          pushBounded(store().otelSpans, span);
          recorded.push(span);
        }
      }
    }
  }

  return { accepted: true, spansRecorded: recorded.length, spans: recorded };
}

export async function withTracedSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  try {
    const result = await fn();
    pushBounded(store().otelSpans, {
      traceId,
      spanId,
      name,
      serviceName: "@athena/web",
      kind: "INTERNAL",
      durationMs: Math.max(1, Date.now() - started),
      status: "OK",
      attributes,
      recordedAt: new Date().toISOString(),
    });
    return result;
  } catch (err) {
    pushBounded(store().otelSpans, {
      traceId,
      spanId,
      name,
      serviceName: "@athena/web",
      kind: "INTERNAL",
      durationMs: Math.max(1, Date.now() - started),
      status: "ERROR",
      attributes: { ...attributes, "error.message": (err as Error).message },
      recordedAt: new Date().toISOString(),
    });
    throw err;
  }
}

/**
 * Strips query strings and fragments from CSP URIs so tokens in URLs are never logged.
 */
export function sanitizeCspUri(rawUri: string | undefined | null): string {
  const val = String(rawUri ?? "").trim();
  if (!val) return "inline";
  if (val === "inline" || val === "eval" || val === "data" || val === "blob" || val === "about") {
    return val;
  }
  try {
    if (val.startsWith("/")) {
      return val.split("?")[0]!.split("#")[0]!.slice(0, 200);
    }
    const parsed = new URL(val);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 200);
  } catch {
    return val.split("?")[0]!.split("#")[0]!.slice(0, 200);
  }
}

export function parseAndRecordCspReport(
  rawBody: string,
  userAgent: string | null = null,
): CspViolationRecord[] {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_CSP_BODY_BYTES) {
    throw new Error("CSP report payload exceeds maximum size of 32KB");
  }
  if (!rawBody.trim()) return [];

  const parsed = JSON.parse(rawBody) as unknown;
  const rawItems: Array<Record<string, unknown>> = [];

  if (Array.isArray(parsed)) {
    for (const entry of parsed.slice(0, 20)) {
      if (entry && typeof entry === "object") {
        const body = (entry as Record<string, unknown>).body;
        if (body && typeof body === "object") {
          rawItems.push(body as Record<string, unknown>);
        } else {
          rawItems.push(entry as Record<string, unknown>);
        }
      }
    }
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (obj["csp-report"] && typeof obj["csp-report"] === "object") {
      rawItems.push(obj["csp-report"] as Record<string, unknown>);
    } else if (obj.body && typeof obj.body === "object") {
      rawItems.push(obj.body as Record<string, unknown>);
    } else {
      rawItems.push(obj);
    }
  }

  const created: CspViolationRecord[] = [];
  const now = new Date().toISOString();

  for (const item of rawItems) {
    const violated = String(
      item["violated-directive"] ?? item.violatedDirective ?? item["effective-directive"] ?? item.effectiveDirective ?? "default-src",
    )
      .trim()
      .slice(0, 120);
    const effective = String(
      item["effective-directive"] ?? item.effectiveDirective ?? violated.split(/\s+/)[0] ?? "default-src",
    )
      .trim()
      .slice(0, 80);

    const rec: CspViolationRecord = {
      id: `csp_${randomBytes(6).toString("hex")}`,
      documentUri: sanitizeCspUri(String(item["document-uri"] ?? item.documentURL ?? item.documentUri ?? "/")),
      violatedDirective: violated,
      effectiveDirective: effective,
      blockedUri: sanitizeCspUri(String(item["blocked-uri"] ?? item.blockedURL ?? item.blockedUri ?? "inline")),
      sourceFile:
        item["source-file"] || item.sourceFile
          ? sanitizeCspUri(String(item["source-file"] ?? item.sourceFile))
          : null,
      lineNumber:
        typeof (item["line-number"] ?? item.lineNumber) === "number"
          ? Number(item["line-number"] ?? item.lineNumber)
          : null,
      disposition:
        String(item.disposition ?? "enforce").toLowerCase() === "report" ? "report" : "enforce",
      userAgent: userAgent ? userAgent.slice(0, 160) : null,
      recordedAt: now,
    };
    pushBounded(store().cspReports, rec);
    created.push(rec);
  }

  return created;
}

/**
 * What one organization may see: its own first-party events, heartbeats and
 * survey answers. Traces, CSP reports and Web Vitals are platform data and
 * are not shown to tenants.
 */
export function getObservabilitySnapshot(organizationId: string) {
  const s = store();
  const own = <T extends { organizationId: string | null }>(rows: T[]) => rows.filter((r) => r.organizationId === organizationId);
  const events = own(s.events);
  const sessionReplays = own(s.sessionReplays);
  const surveys = own(s.surveys);
  const nps = surveys.filter((x) => x.category === "nps").map((x) => x.score);
  return {
    events,
    sessionReplays,
    surveys,
    webVitals: [] as WebVitalRecord[],
    otelSpans: [] as OtelSpanRecord[],
    cspReports: [] as CspViolationRecord[],
    summary: {
      eventsCount: events.length,
      sessionReplaysCount: sessionReplays.length,
      surveysCount: surveys.length,
      avgSurveyScore: nps.length ? Number((nps.reduce((x, y) => x + y, 0) / nps.length).toFixed(1)) : null,
      otelSpansCount: 0,
      cspReportsCount: 0,
      posthogConfigured: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
      otelCollectorConfigured: Boolean(validateOtlpCollectorEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)),
      vercelAnalyticsEnabled: true,
      speedInsightsEnabled: true,
    },
  };
}

/** Platform-level telemetry (operators and tests only; never sent to tenants). */
export function getPlatformTelemetry() {
  const s = store();
  return { otelSpans: s.otelSpans, cspReports: s.cspReports, webVitals: s.webVitals };
}
