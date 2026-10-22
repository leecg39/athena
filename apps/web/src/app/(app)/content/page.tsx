import { PageHeader } from "@/components/page-header";
import { ContentGrid } from "@/components/content-grid";

export const metadata = { title: "Content" };

export default async function ContentPage() {
  return (
    <div>
      <PageHeader
        title="Content"
        subtitle="Manage, generate, import and publish content — grounded in real opportunities"
        actions={
          <>
            <button className="btn-secondary">Import URL</button>
            <button className="btn-primary">+ New content</button>
          </>
        }
      />
      <div className="p-6">
        <ContentGrid />
      </div>
    </div>
  );
}
