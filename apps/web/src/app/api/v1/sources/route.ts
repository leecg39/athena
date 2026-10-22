import { NextRequest, NextResponse } from "next/server";
import { authenticate, isResponse } from "@/lib/api-key";
import { demoSources } from "@/lib/demo";

/** GET /api/v1/sources?websiteId=… — cited domains with aggregate metrics. */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;
  const rootDomain = req.nextUrl.searchParams.get("root_domain");
  const all = demoSources();
  const data = rootDomain ? all.filter((s) => s.domain === rootDomain) : all;
  return NextResponse.json({ data });
}
