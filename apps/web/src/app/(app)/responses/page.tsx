import { PageHeader } from "@/components/page-header";
import { ResponsesTable } from "@/components/responses-table";
import { getResponses } from "@/lib/data";

export const metadata = { title: "Responses" };

export default async function ResponsesPage() {
  const responses = await getResponses();
  return (
    <div>
      <PageHeader
        title="Responses"
        subtitle="Every AI-model response collected for your tracked prompts"
        actions={<button className="btn-primary">Run collection</button>}
      />
      <div className="p-6">
        <ResponsesTable responses={responses} />
      </div>
    </div>
  );
}
