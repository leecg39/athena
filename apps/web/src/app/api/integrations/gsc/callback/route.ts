import { NextResponse, type NextRequest } from "next/server";
import { db } from "@athena/db";
import { getWebsiteForUser } from "@athena/core/tenancy";
import { DomainError } from "@athena/core/org";
import { verifyState, exchangeGscCode, listGscSites, matchGscProperty, saveGscConnection } from "@athena/core/integrations";
import { getUser } from "@/lib/session";
import { appBaseUrl } from "@/lib/email";
import { gscConfigured, integrationKey } from "@/lib/integrations";

/** OAuth callback: verify state ↔ session, exchange the code, pick the matching property, store sealed credentials. */
export async function GET(req: NextRequest) {
  const base = await appBaseUrl();
  const user = await getUser();
  const state = verifyState(req.nextUrl.searchParams.get("state") ?? "", integrationKey());
  if (!user || !state || state.userId !== user.id || !gscConfigured()) {
    return NextResponse.json({ error: "invalid or expired authorization state" }, { status: 400 });
  }
  const back = (result: string) => NextResponse.redirect(`${base}/onboarding/${state.websiteId}/search-console?gsc=${result}`);
  if (req.nextUrl.searchParams.get("error")) return back("denied");
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("error");
  const site = await getWebsiteForUser(db, user.id, state.websiteId);
  if (!site) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const tokens = await exchangeGscCode({
      code,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: `${base}/api/integrations/gsc/callback`,
    });
    if (!tokens.refresh_token) return back("no_refresh_token");
    const property = matchGscProperty(await listGscSites(tokens.access_token), site.domain);
    if (!property) return back("no_property");
    await saveGscConnection(db, { actorId: user.id, websiteId: site.id, refreshToken: tokens.refresh_token, property, key: integrationKey() });
    return back("connected");
  } catch (err) {
    if (err instanceof DomainError) {
      console.error("[gsc] connection failed", err.message);
      return back("error");
    }
    throw err;
  }
}
