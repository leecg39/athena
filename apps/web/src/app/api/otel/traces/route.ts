import { NextRequest, NextResponse } from "next/server";

/** OTLP trace ingestion endpoint (forwards to collector when configured). */
export async function POST(req: NextRequest) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.text();
  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-protobuf" },
    body,
  }).catch(() => undefined);
  return NextResponse.json({ accepted: true });
}
