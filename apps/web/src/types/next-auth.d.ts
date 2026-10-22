import "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; email?: string | null; name?: string | null; image?: string | null };
    /** session generation at sign-in (see users.session_version) */
    sv?: number;
  }
}
