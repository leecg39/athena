import { redirect } from "next/navigation";
import { db } from "@athena/db";
import { ensureDefaultGroup } from "@athena/core/pitches";
import { getSettingsContext } from "@/lib/settings-context";

export const dynamic = "force-dynamic";

export default async function GroupIndexRedirectPage() {
  const s = await getSettingsContext();
  const group = await ensureDefaultGroup(db, {
    actorId: s.user.id,
    organizationId: s.organizationId,
  });
  redirect(`/group/${group.id}`);
}
