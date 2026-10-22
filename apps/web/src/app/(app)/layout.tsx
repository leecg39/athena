import { requireUser, getUser } from "@/lib/session";
import { getWorkspace } from "@/lib/data";
import { Sidebar } from "@/components/sidebar";
import { db } from "@athena/db";
import { creditBalances } from "@athena/db";
import { and, eq } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ws = await getWorkspace(user.id);

  let credits = 2700;
  try {
    const [bal] = await db
      .select()
      .from(creditBalances)
      .where(and(eq(creditBalances.organizationId, ws.organizationId)))
      .limit(1);
    if (bal) credits = bal.balance;
  } catch {
    // demo fallback
  }

  const sites = [{ id: ws.websiteId, name: ws.websiteName }];

  return (
    <div className="flex">
      <Sidebar
        websiteName={ws.websiteName}
        websiteDomain={ws.websiteDomain}
        websites={sites}
        credits={credits}
        userEmail={user.email ?? ""}
      />
      <main className="h-screen flex-1 overflow-y-auto bg-white">{children}</main>
    </div>
  );
}

export { getUser };
