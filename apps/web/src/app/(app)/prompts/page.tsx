import { PageHeader } from "@/components/page-header";
import { PromptsWorkspace } from "@/components/prompts-workspace";
import { getPrompts } from "@/lib/data";

export const metadata = { title: "Prompts" };

export default async function PromptsPage() {
  const data = await getPrompts();
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
