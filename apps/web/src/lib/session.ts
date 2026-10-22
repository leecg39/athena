import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/** Current signed-in user (null when unauthenticated). */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.email) return null;
  return session.user as SessionUser;
}

/** Require auth; redirect to login when missing. */
export async function requireUser(redirectTo = "/home"): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  return user;
}
