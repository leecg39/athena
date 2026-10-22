import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { requireWebsitePermission } from "@athena/core/tenancy";
import { ForbiddenError } from "@athena/core/org";
import { gscAuthUrl, signState } from "@athena/core/integrations";
import { getUser } from "@/lib/session";
import { appBaseUrl } from "@/lib/email";
import { gscConfigured, integrationKey } from "@/lib/integrations";

/** GET /api/integrations/gsc/connect?websiteId= → Google consent screen (read-only Search Console). */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!gscConfigured()) return NextResponse.json({ error: "Google OAuth is not configured" }, { status: 503 });
  const websiteId = req.nextUrl.searchParams.get("websiteId") ?? "";
  try {
    await requireWebsitePermission(db, user.id, websiteId, "websites:write");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw err;
  }
  const state = signState({ websiteId, userId: user.id }, integrationKey());
  const url = gscAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    redirectUri: `${await appBaseUrl()}/api/integrations/gsc/callback`,
    state,
  });
  return NextResponse.redirect(url);
}
