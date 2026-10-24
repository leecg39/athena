import { and, eq, isNull } from "drizzle-orm";
import { db, creditBalances } from "@athena/db";
import { requireWorkspace } from "@/lib/workspace";
import { switchWorkspace } from "@/lib/workspace-actions";
import { signOut } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();

  const [bal] = await db
    .select({ balance: creditBalances.balance })
    .from(creditBalances)
    .where(
      and(
        eq(creditBalances.organizationId, ws.organizationId),
        isNull(creditBalances.websiteId),
        isNull(creditBalances.groupId),
      ),
    )
    .limit(1);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="app-shell flex">
      <Sidebar
        currentId={ws.websiteId}
        websites={ws.sites.map((s) => ({ id: s.id, name: s.name, domain: s.domain }))}
        credits={bal?.balance ?? 0}
        userEmail={ws.user.email ?? ""}
        switchAction={switchWorkspace}
        logoutAction={logout}
      />
      <main className="h-screen flex-1 overflow-y-auto bg-white">{children}</main>
    </div>
  );
}
