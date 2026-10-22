import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@athena/db";
import { listWebsitesForUser, getWebsiteForUser, type WebsiteRow } from "@athena/core/tenancy";
import { requireUser, type SessionUser } from "./session";
import { pickWebsite } from "./workspace-pick";

export const WS_COOKIE = "athenum_ws";

export interface Workspace {
  user: SessionUser;
  website: WebsiteRow;
  websiteId: string;
  organizationId: string;
  sites: WebsiteRow[];
}

/**
 * Active workspace for the signed-in user. The cookie is only a preference:
 * access is re-validated against memberships on every request. Database
 * failures propagate (error boundary) instead of being masked by fake data.
 */
export const requireWorkspace = cache(async (): Promise<Workspace> => {
  const user = await requireUser();
  const sites = await listWebsitesForUser(db, user.id);
  const preferred = (await cookies()).get(WS_COOKIE)?.value;
  const website = pickWebsite(sites, preferred);
  if (!website) redirect("/onboarding");
  return { user, website, websiteId: website.id, organizationId: website.organizationId, sites };
});

/** Persist the active website after verifying access. Returns false when denied. */
export async function setActiveWebsite(userId: string, websiteId: string): Promise<boolean> {
  const site = await getWebsiteForUser(db, userId, websiteId);
  if (!site) return false;
  (await cookies()).set(WS_COOKIE, site.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}
