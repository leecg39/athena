import { PageHeader } from "@/components/page-header";
import { OutreachKanban } from "@/components/outreach-kanban";
import { demoOutreach } from "@/lib/data";

export const metadata = { title: "Outreach" };

export default async function OutreachPage() {
  return (
    <div>
      <PageHeader
        title="Outreach"
        subtitle="Triage pages AI cites as outreach opportunities — find authors, draft pitches, track status"
        actions={<span className="text-xs text-gray-400">{demoOutreach.length} of 216.9k opportunities</span>}
      />
      <div className="p-6">
        <OutreachKanban opportunities={demoOutreach.map((o) => ({ ...o, status: o.status.toLowerCase() as "new" | "todo" | "done" }))} />
      </div>
    </div>
  );
}
