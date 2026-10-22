import { PageHeader } from "@/components/page-header";
import { demoShopping } from "@/lib/data";

export const metadata = { title: "Shopping Insights" };

export default async function ShoppingPage() {
  const maxAppearances = Math.max(...demoShopping.map((s) => s.appearances));
  return (
    <div>
      <PageHeader title="Shopping Insights" subtitle="How your products appear in AI shopping answers (ChatGPT, AI Mode, Gemini carousels)" />
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Product appearances" value="5.9k" />
          <Tile label="Avg position" value="#2.0" />
          <Tile label="Avg price shown" value="$16.50" />
          <Tile label="Retailer coverage" value="18" />
        </div>
        <div className="metric-card">
          <div className="mb-3 text-sm font-semibold text-gray-900">AI shopping leaderboard</div>
          <div className="space-y-2">
            {demoShopping.map((s) => (
              <div key={s.product} className="flex items-center gap-3">
                <span className={`w-44 truncate text-sm ${s.isOwn ? "font-semibold text-brand-600" : "text-gray-600"}`}>{s.product}</span>
                <div className="h-2.5 flex-1 rounded-full bg-gray-100">
                  <div className={`h-2.5 rounded-full ${s.isOwn ? "bg-brand-600" : "bg-gray-300"}`} style={{ width: `${(s.appearances / maxAppearances) * 100}%` }} />
                </div>
                <span className="w-24 text-right text-xs text-gray-400">{s.retailer} · ${s.price}</span>
                <span className="w-12 text-right text-xs font-medium text-gray-700">{((s.appearances / 6000) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile(props: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="text-xs text-gray-400">{props.label}</div>
      <div className="mt-1 text-xl font-bold text-gray-900">{props.value}</div>
    </div>
  );
}
