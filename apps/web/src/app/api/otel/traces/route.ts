import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import {
  getObservabilitySnapshot,
  MAX_OTEL_BODY_BYTES,
  parseAndRecordOtelTraces,
  validateOtlpCollectorEndpoint,
} from "@/lib/telemetry";

/**
 * POST /api/otel/traces
 * OTLP trace ingestion endpoint (records normalized spans in-memory and forwards to collector when configured).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_OTEL_BODY_BYTES) {
    return NextResponse.json({ error: "OTLP trace payload too large" }, { status: 413 });
  }

  const contentType = req.headers.get("content-type") ?? "application/json";
  let result: { accepted: true; spansRecorded: number };
  try {
    result = parseAndRecordOtelTraces(rawBody, contentType);
  } catch {
    return NextResponse.json({ error: "Malformed OTLP trace payload" }, { status: 400 });
  }

  const collectorUrl = validateOtlpCollectorEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (collectorUrl) {
    await fetch(collectorUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: rawBody,
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }

  return NextResponse.json({
    accepted: true,
    spansRecorded: result.spansRecorded,
    forwarded: Boolean(collectorUrl),
  });
}

/**
 * GET /api/otel/traces
 * Returns recent recorded OTLP trace spans for authenticated workspace operators.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const snap = getObservabilitySnapshot();
  return NextResponse.json({
    data: snap.otelSpans,
    total: snap.otelSpans.length,
  });
}
