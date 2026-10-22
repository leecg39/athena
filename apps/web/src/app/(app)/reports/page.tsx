import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Reports" };

const REPORTS = [
  { id: "r1", name: "Executive weekly", charts: 4, cadence: "weekly · Mon 9:00", recipients: 3 },
  { id: "r2", name: "Board deck export", charts: 6, cadence: "monthly", recipients: 2 },
];

export default async function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Scheduled reports, saved chart sets, PDF export and public share links"
        actions={<button className="btn-primary">+ New report</button>}
      />
      <div className="p-6">
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>Name</th>
                <th>Charts</th>
                <th>Cadence</th>
                <th>Recipients</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {REPORTS.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-gray-500">{r.charts}</td>
                  <td className="text-gray-500">{r.cadence}</td>
                  <td className="text-gray-500">{r.recipients}</td>
                  <td className="space-x-2 text-right">
                    <button className="btn-secondary !px-3 !py-1 text-xs">Send now</button>
                    <button className="btn-secondary !px-3 !py-1 text-xs">PDF</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
