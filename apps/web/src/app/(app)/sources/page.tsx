import { PageHeader } from "@/components/page-header";
import { SourcesTable } from "@/components/sources-table";
import { demoSources } from "@/lib/data";

export const metadata = { title: "Sources" };

export default async function SourcesPage() {
  return (
    <div>
      <PageHeader
        title="Sources"
        subtitle="Which websites AI search engines cite across your tracked prompts"
        actions={
          <>
            <button className="btn-secondary">Visualization</button>
            <input className="input max-w-xs" placeholder="Inspect a URL…" />
          </>
        }
      />
      <div className="p-6">
        <SourcesTable sources={demoSources()} />
      </div>
    </div>
  );
}
