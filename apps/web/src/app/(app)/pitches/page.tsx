import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { configuredAdapters } from "@athena/llm";
import { findDefaultGroup, getPitchUsage, listPitches } from "@athena/core/pitches";
import { getOrgBalance } from "@athena/core/billing";
import { PageHeader } from "@/components/page-header";
import { PitchWorkspaceView } from "@/components/pitch-workspace-view";
import { getSettingsContext } from "@/lib/settings-context";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Pitches") };
}
export const dynamic = "force-dynamic";
/** creating a pitch collects AI answers synchronously (up to 5 questions per provider) */
export const maxDuration = 300;

export default async function PitchesPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const c = { actorId: s.user.id, organizationId: s.organizationId };
  const [pitches, usage, group, credits] = await Promise.all([listPitches(db, c), getPitchUsage(db, c), findDefaultGroup(db, c), getOrgBalance(db, s.organizationId)]);
  const providers = configuredAdapters().map((a) => a.label);
  return (
    <div>
      <PageHeader title={tt("Pitch Workspace")} subtitle={tt("Shareable AI-search audits of a prospect's site, measured from AI answers collected for their buyer questions")} />
      <PitchWorkspaceView pitches={pitches} usage={usage} group={group} providers={providers} credits={credits} canWrite={s.can("content:write")} />
    </div>
  );
}
