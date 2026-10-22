import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db, users } from "@athena/db";

/** Dev-only email login: enable ONLY by setting AUTH_DEV_LOGIN=true (never set in production deployments). */
const devLogin = process.env.AUTH_DEV_LOGIN === "true";

const providers = [
  ...(process.env.GOOGLE_CLIENT_ID
    ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" })]
    : []),
  ...(process.env.MICROSOFT_CLIENT_ID
    ? [
        MicrosoftEntraID({
          clientId: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
        }),
      ]
    : []),
  ...(process.env.RESEND_API_KEY
    ? [
        Resend({
          apiKey: process.env.RESEND_API_KEY,
          from: process.env.EMAIL_FROM ?? "Athenum <noreply@example.com>",
        }),
      ]
    : []),
  ...(devLogin
    ? [
        Credentials({
          name: "Development Login",
          credentials: { email: { label: "Email", type: "email" } },
          authorize: async (creds) => {
            const email = creds?.email?.toString().trim().toLowerCase();
            if (!email) return null;
            try {
              const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
              if (!existing.length) {
                await db
                  .insert(users)
                  .values({ email, name: email.split("@")[0] })
                  .onConflictDoNothing();
              }
            } catch {
              // DB unavailable — still allow the dev session
            }
            return { id: email, name: email.split("@")[0], email };
          },
        }),
      ]
    : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) {
        try {
          const existing = await db.select().from(users).where(eq(users.email, user.email)).limit(1);
          if (!existing.length) {
            await db.insert(users).values({ email: user.email, name: user.name, image: user.image });
          }
          const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, user.email)).limit(1);
          if (row) token.uid = row.id;
        } catch {
          // DB unavailable — JWT-only session
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) (session.user as { id?: string }).id = token.uid as string;
      return session;
    },
  },
});
