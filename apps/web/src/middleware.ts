import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./lib/auth.config";

const { auth } = NextAuth(authConfig);

/**
 * Access control runs in `authConfig.callbacks.authorized`. Requests that pass
 * get the current path forwarded so server-side re-auth (e.g. after a revoked
 * session) can send the user back to where they were.
 */
export default auth((req) => {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
