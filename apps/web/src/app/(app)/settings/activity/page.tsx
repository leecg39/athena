import { PageHeader } from "@/components/page-header";
import { demoActivity } from "@/lib/data";

export const metadata = { title: "Activity Log" };

export default async function ActivityPage() {
  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Changes to prompts, topics, tags, members and settings across your organization" />
      <div className="overflow-x-auto rounded-xl border border-gray-100 m-6">
        <table className="table-base">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Change</th>
              <th>Detail</th>
              <th>Actor</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {demoActivity.map((a) => (
              <tr key={a.id}>
                <td className="badge bg-gray-100 text-gray-600">{a.entity}</td>
                <td>
                  <span className="badge bg-brand-50 text-brand-600">{a.change}</span>
                </td>
                <td>{a.detail}</td>
                <td className="text-gray-500">{a.actor}</td>
                <td className="text-gray-400">{a.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
