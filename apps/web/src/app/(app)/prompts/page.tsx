import Link from "next/link";
import { db } from "@athena/db";
import { getMembership } from "@athena/core/org";
import { listPrompts, listTopics, listTags, listPersonas, listLocations, listSchedules } from "@athena/core/prompts";
import { PageHeader } from "@/components/page-header";
import { requireWorkspace } from "@/lib/workspace";
import { UniverseTab } from "./_tabs/universe";
import { TopicsTab, TagsTab, PersonasTab, LocationsTab } from "./_tabs/taxonomy";
import { SchedulesTab } from "./_tabs/schedules";
import { DiscoverTab } from "./_tabs/discover";
import { RunsTab } from "./_tabs/runs";

export const metadata = { title: "Prompts" };

const TABS = [
  ["prompt-universe", "Prompt Universe"],
  ["topics", "Topics"],
  ["tags", "Tags"],
  ["personas", "Personas"],
  ["locations", "Locations"],
  ["schedules", "Schedules"],
  ["discover", "Discover"],
  ["runs", "Runs"],
] as const;
type TabId = (typeof TABS)[number][0];

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function PromptsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const tab: TabId = TABS.some(([id]) => id === sp.tab) ? (sp.tab as TabId) : "prompt-universe";
  const c = { actorId: ws.user.id, websiteId: ws.websiteId };
  const membership = await getMembership(db, ws.user.id, ws.organizationId);
  const canWrite = membership?.permissions.includes("prompts:write") ?? false;

  let body: React.ReactNode = null;
  if (tab === "prompt-universe") {
    const uuid = (v?: string) => (v && UUID.test(v) ? v : undefined);
    const filters = {
      q: sp.q?.slice(0, 200) || undefined,
      topicId: uuid(sp.topicId),
      tagId: uuid(sp.tagId),
      personaId: uuid(sp.personaId),
      status: sp.status === "active" || sp.status === "paused" ? sp.status : undefined,
      type: sp.type === "branded" || sp.type === "non_branded" ? sp.type : undefined,
    } as const;
    const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
    const [list, topics, tags, personas, locations, schedules] = await Promise.all([
      listPrompts(db, { ...c, filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      listTopics(db, c),
      listTags(db, c),
      listPersonas(db, c),
      listLocations(db, c),
      listSchedules(db, c),
    ]);
    body = (
      <UniverseTab
        rows={list.rows}
        total={list.total}
        topics={topics}
        tags={tags}
        personas={personas}
        locations={locations}
        schedules={schedules}
        filters={filters}
        editId={uuid(sp.edit)}
        canWrite={canWrite}
        page={page}
        pageSize={PAGE_SIZE}
      />
    );
  } else if (tab === "topics") body = <TopicsTab topics={await listTopics(db, c)} canWrite={canWrite} />;
  else if (tab === "tags") body = <TagsTab tags={await listTags(db, c)} canWrite={canWrite} />;
  else if (tab === "personas") body = <PersonasTab personas={await listPersonas(db, c)} canWrite={canWrite} />;
  else if (tab === "locations") body = <LocationsTab locations={await listLocations(db, c)} canWrite={canWrite} defaultCountry={ws.website.country} />;
  else if (tab === "schedules") body = <SchedulesTab schedules={await listSchedules(db, c)} canWrite={canWrite} />;
  else if (tab === "runs") body = <RunsTab websiteId={ws.websiteId} organizationId={ws.organizationId} canWrite={canWrite} />;
  else body = <DiscoverTab canWrite={canWrite} />;

  return (
    <div>
      <PageHeader title="Prompts" subtitle="What buyers ask AI assistants — the questions we track for your brand" />
      {sp.welcome ? (
        <div className="mx-6 mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Setup complete. Your prompts are scheduled; answers appear in Olympus after the first collection run.
        </div>
      ) : null}
      <nav className="flex gap-1 border-b border-gray-100 px-6" aria-label="Prompt sections">
        {TABS.map(([id, label]) => (
          <Link
            key={id}
            href={`/prompts?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={`border-b-2 px-3 py-2.5 text-sm transition ${tab === id ? "border-brand-600 font-medium text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="p-6">{body}</div>
    </div>
  );
}
