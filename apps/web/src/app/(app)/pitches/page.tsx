import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Pitches" };

const PITCHES = [
  { id: "p1", brand: "acme.io", kind: "visibility", created: "2d ago", uses: 1 },
  { id: "p2", brand: "northwind.com", kind: "content", created: "1w ago", uses: 3 },
];

export default async function PitchesPage() {
  return (
    <div>
      <PageHeader
        title="Pitch Workspace"
        subtitle="Generate shareable AI-search reports for prospects from a website URL"
        actions={<button className="btn-primary">+ Create pitch</button>}
      />
      <div className="p-6">
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Kind</th>
                <th>Created</th>
                <th>Public link</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {PITCHES.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.brand}</td>
                  <td>
                    <span className="badge bg-brand-50 text-brand-600">{p.kind}</span>
                  </td>
                  <td className="text-gray-500">{p.created}</td>
                  <td>
                    <a className="text-brand-600 underline" href={`/report/demo-${p.id}`}>
                      /report/demo-{p.id}
                    </a>
                  </td>
                  <td className="text-right">
                    <button className="btn-secondary !px-3 !py-1 text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 rounded-xl bg-brand-50 p-4 text-sm text-brand-700">
          Pitch usage this month: <strong>4 / 10</strong> (Starter add-on). Upgrade for unlimited pitches.
        </div>
      </div>
    </div>
  );
}
