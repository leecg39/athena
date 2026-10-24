import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, organizations } from "@athena/db";
import { findInviteByToken, acceptInvite, DomainError } from "@athena/core/org";
import { requireUser } from "@/lib/session";
import { setActiveWebsite } from "@/lib/workspace";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Accept invitation") };
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const tt = await getTranslations();
  const { token } = await params;
  const { error } = await searchParams;
  const user = await requireUser(`/invite/${encodeURIComponent(token)}`);
  const invite = await findInviteByToken(db, token);
  const [org] = invite ? await db.select().from(organizations).where(eq(organizations.id, invite.organizationId)) : [];

  async function accept() {
    "use server";
    const me = await requireUser();
    let target = "/home";
    try {
      await acceptInvite(db, { token, userId: me.id });
      if (invite?.websiteId) await setActiveWebsite(me.id, invite.websiteId);
    } catch (err) {
      if (err instanceof DomainError) target = `/invite/${encodeURIComponent(token)}?error=1`;
      else throw err;
    }
    redirect(target);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        {!invite || !org ? (
          <>
            <h1 className="text-lg font-semibold">{tt("Invitation unavailable")}</h1>
            <p className="mt-2 text-sm text-gray-500">{tt("This invite link is invalid, was revoked, or has expired. Ask for a new one.")}</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">{tt("Join ")}{org.name}</h1>
            <p className="mt-2 text-sm text-gray-500">
              {tt("You were invited as ")}<strong>{tt(invite.role)}</strong>{tt(". Signed in as ")}{user.email}.
            </p>
            {invite.email.toLowerCase() !== (user.email ?? "").toLowerCase() ? (
              <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {tt("This invite was sent to ")}{invite.email}{tt(". Sign in with that address to accept it.")}</p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {tt("This invitation could not be accepted. Check that you are signed in with the invited email address.")}</p>
            ) : null}
            <form action={accept} className="mt-6">
              <button type="submit" className="btn-primary w-full">
                {tt("Accept invitation")}</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
