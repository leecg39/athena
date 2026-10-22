import { PageHeader } from "@/components/page-header";
import { PromptsWorkspace } from "@/components/prompts-workspace";
import { getPrompts } from "@/lib/data";
import { requireWorkspace } from "@/lib/workspace";

export const metadata = { title: "Prompts" };

export default async function PromptsPage() {
  const ws = await requireWorkspace();
  const data = await getPrompts(ws.websiteId);
  return (
    <div>
      <PageHeader
        title="Prompts"
        subtitle="Manage tracked prompts, topics, personas and locations"
        actions={<button className="btn-primary">Run collection</button>}
      />
      <PromptsWorkspace prompts={data.prompts} topics={data.topics} />
    </div>
  );
}
