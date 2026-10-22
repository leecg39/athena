import { notFound, redirect } from "next/navigation";
import { db } from "@athena/db";
import { ensureDefaultGroup, getGroupDashboardData } from "@athena/core/pitches";
import { PageHeader } from "@/components/page-header";
import { GroupDashboardView } from "@/components/group-dashboard-view";
import { getSettingsContext } from "@/lib/settings-context";

export const metadata = { title: "Group Dashboard & Billing" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GroupDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const s = await getSettingsContext();
  const { id } = await params;
  const sp = await searchParams;

  if (!UUID_RE.test(id)) {
    const def = await ensureDefaultGroup(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
    });
    redirect(`/group/${def.id}`);
  }

  let data;
  try {
    data = await getGroupDashboardData(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      groupId: id,
    });
  } catch {
    notFound();
  }

  const initialTab = sp.tab === "billing" ? "billing" : "dashboard";

  return (
    <div>
      <PageHeader
        title={`Group Dashboard — ${data.group.name}`}
        subtitle="Aggregated AI search visibility, saved views, and shared credit pool across every website in this portfolio group"
      />
      <GroupDashboardView data={data} initialTab={initialTab} />
    </div>
  );
}
