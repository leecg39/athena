import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@athena/db";
import { getSessionVersion } from "@athena/core/org";
import { auth } from "@/lib/auth";
import { safeRedirect } from "@/lib/auth.config";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * Current signed-in user (null when unauthenticated, deleted, or the session
 * was revoked via "sign out everywhere"). Cached per request.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  const current = await getSessionVersion(db, u.id);
  if (current === null || current !== (session?.sv ?? 0)) return null;
  return { id: u.id, name: u.name ?? null, email: u.email ?? null, image: u.image ?? null };
});

/** Require auth; redirect to login (preserving the destination) when missing. */
export async function requireUser(redirectTo?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) {
    const fromMiddleware = (await headers()).get("x-pathname");
    const target = safeRedirect(redirectTo ?? fromMiddleware ?? "/home");
    redirect(`/login?redirect=${encodeURIComponent(target)}`);
  }
  return user;
}
