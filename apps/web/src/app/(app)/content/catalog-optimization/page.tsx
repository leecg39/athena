import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Catalog Optimization" };

const PRODUCTS = [
  { title: "AI Design Canvas Pro", price: "$29/mo", titleScore: 62, descScore: 48, faq: "missing" },
  { title: "Team Workspace", price: "$12/seat", titleScore: 81, descScore: 74, faq: "ok" },
  { title: "Design Tokens Engine", price: "$19/mo", titleScore: 35, descScore: 41, faq: "missing" },
];

export default function CatalogOptimizationPage() {
  return (
    <div>
      <PageHeader
        title="Catalog Optimization"
        subtitle="Review your Shopify catalog and generate AI-recommended product content"
        actions={<button className="btn-primary">Sync Shopify catalog</button>}
      />
      <div className="overflow-x-auto p-6">
        <table className="table-base rounded-xl border border-gray-100">
          <thead>
            <tr>
              <th>Product</th>
              <th>Price</th>
              <th>Title score</th>
              <th>Description score</th>
              <th>FAQ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {PRODUCTS.map((p) => (
              <tr key={p.title}>
                <td className="font-medium">{p.title}</td>
                <td className="text-gray-500">{p.price}</td>
                <td>
                  <Score value={p.titleScore} />
                </td>
                <td>
                  <Score value={p.descScore} />
                </td>
                <td>
                  <span className={`badge ${p.faq === "ok" ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-500"}`}>{p.faq}</span>
                </td>
                <td className="text-right">
                  <button className="btn-secondary !px-3 !py-1 text-xs">Generate drafts</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Score({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-gray-100">
        <div className={`h-1.5 rounded-full ${value < 50 ? "bg-orange-400" : "bg-emerald-500"}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-gray-500">{value}</span>
    </div>
  );
}
