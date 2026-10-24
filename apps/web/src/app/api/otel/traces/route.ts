import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_OTEL_BODY_BYTES, parseAndRecordOtelTraces, validateOtlpCollectorEndpoint } from "@/lib/telemetry";

function authorized(req: NextRequest, token: string): boolean {
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /api/otel/traces — OTLP/JSON span ingestion for the platform's own
 * exporters. Requires OTEL_INGEST_TOKEN as a bearer token; spans are platform
 * data and are not shown to tenants.
 */
export async function POST(req: NextRequest) {
  const token = process.env.OTEL_INGEST_TOKEN;
  if (!token) return NextResponse.json({ error: "trace ingestion is not configured" }, { status: 501 });
  if (!authorized(req, token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_OTEL_BODY_BYTES) return NextResponse.json({ error: "OTLP trace payload too large" }, { status: 413 });
  const contentType = req.headers.get("content-type") ?? "application/json";
  let result: { accepted: true; spansRecorded: number };
  try {
    result = parseAndRecordOtelTraces(rawBody, contentType);
  } catch {
    return NextResponse.json({ error: "Malformed OTLP trace payload" }, { status: 400 });
  }
  const collectorUrl = validateOtlpCollectorEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (collectorUrl) {
    await fetch(collectorUrl, { method: "POST", headers: { "Content-Type": contentType }, body: rawBody, signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
  }
  return NextResponse.json({ accepted: true, spansRecorded: result.spansRecorded, forwarded: Boolean(collectorUrl) });
}
