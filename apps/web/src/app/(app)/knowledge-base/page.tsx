import { PageHeader } from "@/components/page-header";
import { KbWorkspace } from "@/components/kb-workspace";

export const metadata = { title: "Knowledge Base" };

export default function KnowledgeBasePage() {
  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        subtitle="Verified brand facts that ground AI research, content generation and accuracy checks"
        actions={<button className="btn-primary">+ Add brand facts</button>}
      />
      <KbWorkspace />
    </div>
  );
}
