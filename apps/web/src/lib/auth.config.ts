import type { NextAuthConfig } from "next-auth";

/** Paths reachable without a session (auth, public share views, key-authenticated APIs, webhooks). */
const PUBLIC_PATHS: RegExp[] = [
  /^\/login(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /^\/report(\/|$)/,
  /^\/share(\/|$)/,
  /^\/api\/v1(\/|$)/,
  /^\/api\/inngest(\/|$)/,
  /^\/api\/stripe\/webhook$/,
  /^\/api\/csp-report$/,
  /^\/api\/otel\/traces$/,
  /^\/api\/version$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

/** Only same-origin relative paths are accepted as post-login redirects. */
export function safeRedirect(raw: unknown, fallback = "/home"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

/** Edge-safe Auth.js config (no DB adapter) — shared by middleware and the full config. */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      if (isPublicPath(request.nextUrl.pathname)) return true;
      if (auth?.user?.id) return true;
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const login = new URL("/login", request.nextUrl.origin);
      login.searchParams.set("redirect", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return Response.redirect(login);
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string" && session.user) session.user.id = token.uid;
      return session;
    },
  },
} satisfies NextAuthConfig;
