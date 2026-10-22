import { SettingsShell } from "@/components/settings-shell";

export const metadata = { title: "Settings — Billing" };

export default function BillingSettingsPage() {
  return (
    <SettingsShell active="billing" title="Billing Settings" subtitle="Plan, credits, invoices and payment details">
      <div className="space-y-4">
        <div className="metric-card flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Free plan</div>
            <div className="text-xs text-gray-400">300 credits / month · 5 AI models</div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-xs">Upgrade to Starter ($295/mo)</button>
            <button className="btn-secondary text-xs">Buy credits</button>
          </div>
        </div>
        <div className="metric-card">
          <div className="mb-2 text-sm font-semibold text-gray-900">Recent invoices</div>
          <div className="text-xs text-gray-400">No invoices yet — you are on the free plan.</div>
        </div>
        <div className="metric-card">
          <div className="mb-2 text-sm font-semibold text-gray-900">Payment method</div>
          <div className="text-xs text-gray-400">No payment method on file.</div>
          <button className="btn-secondary mt-3 text-xs">+ Add payment method</button>
        </div>
      </div>
    </SettingsShell>
  );
}
