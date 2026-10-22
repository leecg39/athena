import { NextResponse } from "next/server";

/** Version/health endpoint (mirrors observed /api/version). */
export async function GET() {
  return NextResponse.json({
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    deployment: process.env.VERCEL_DEPLOYMENT_ID ?? "local",
    time: new Date().toISOString(),
  });
}
