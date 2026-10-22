import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, getDb, users, accounts, sessions, verificationTokens } from "@athena/db";
import { ensureUserWithOrg } from "@athena/core/tenancy";
import { getSessionVersion } from "@athena/core/org";
import { authConfig } from "./auth.config";

/** Passwordless developer login: requires AUTH_DEV_LOGIN=true AND a non-production runtime. */
export const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

export interface ProviderInfo {
  id: "google" | "microsoft-entra-id" | "resend" | "dev";
  label: string;
}

function buildProviders(): { providers: Provider[]; info: ProviderInfo[] } {
  const providers: Provider[] = [];
  const info: ProviderInfo[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push(Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }));
    info.push({ id: "google", label: "Continue with Google" });
  }
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    providers.push(
      MicrosoftEntraID({
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? "common"}/v2.0`,
      }),
    );
    info.push({ id: "microsoft-entra-id", label: "Continue with Microsoft" });
  }
  if (process.env.RESEND_API_KEY) {
    providers.push(Resend({ apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM }));
    info.push({ id: "resend", label: "Email me a sign-in link" });
  }
  if (devLoginEnabled) {
    providers.push(
      Credentials({
        id: "dev",
        name: "Developer login",
        credentials: { email: { label: "Email", type: "email" } },
        async authorize(credentials) {
          const email = typeof credentials?.email === "string" ? credentials.email : "";
          // Throws on invalid email or DB failure: no session without a persisted user.
          const { user } = await ensureUserWithOrg(db, { email });
          return { id: user.id, email: user.email, name: user.name };
        },
      }),
    );
    info.push({ id: "dev", label: "Developer login (local only)" });
  }
  return { providers, info };
}

const built = buildProviders();
export const providerInfo: readonly ProviderInfo[] = built.info;

/**
 * The config is built per request (lazy initializer) so importing this module,
 * e.g. during `next build`, never opens a database connection. The adapter is
 * required by the email (magic link) provider for verification tokens.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig,
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  } as never),
  providers: built.providers,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        // remember the session generation; bumping it revokes this token
        token.sv = (await getSessionVersion(db, user.id)) ?? 0;
      }
      return token;
    },
  },
  events: {
    async signIn({ user }) {
      // OAuth/email users are created by the adapter; guarantee an owned organization.
      if (user.email) await ensureUserWithOrg(db, { email: user.email, name: user.name ?? null });
    },
  },
}));
