import { db } from "@athena/db";
import {
  ensureDefaultGroup,
  ensureStarterPitches,
  getPitchUsage,
  listPitches,
} from "@athena/core/pitches";
import { PageHeader } from "@/components/page-header";
import { PitchWorkspaceView } from "@/components/pitch-workspace-view";
import { getSettingsContext } from "@/lib/settings-context";

export const metadata = { title: "Pitches" };
export const dynamic = "force-dynamic";

export default async function PitchesPage() {
  const s = await getSettingsContext();

  await ensureStarterPitches(db, {
    actorId: s.user.id,
    organizationId: s.organizationId,
  });

  const [pitches, usage, defaultGroup] = await Promise.all([
    listPitches(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
    }),
    getPitchUsage(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
    }),
    ensureDefaultGroup(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Pitch Workspace"
        subtitle="Generate shareable AI-search visibility & content rewrite reports for prospects from a website URL"
      />
      <PitchWorkspaceView
        pitches={pitches}
        usage={usage}
        defaultGroupId={defaultGroup.id}
        defaultGroupName={defaultGroup.name}
      />
    </div>
  );
}
