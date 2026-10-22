import { PageHeader } from "@/components/page-header";
import { demoAds } from "@/lib/data";

export const metadata = { title: "Ads" };

export default async function AdsPage() {
  return (
    <div>
      <PageHeader title="Ads" subtitle="Sponsored ads captured across ChatGPT, Google AI Mode and AI Overview responses to your tracked prompts" />
      <div className="p-6">
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>Surface</th>
                <th>Advertiser</th>
                <th>Ad</th>
                <th>Trigger prompt</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {demoAds.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className="badge bg-blue-50 text-blue-700">{a.surface}</span>
                  </td>
                  <td className="font-medium">{a.advertiser}</td>
                  <td className="text-gray-600">{a.text}</td>
                  <td className="text-gray-500">{a.prompt}</td>
                  <td className="text-gray-400">today</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
