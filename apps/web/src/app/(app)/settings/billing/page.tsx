import { and, desc, eq, isNull } from "drizzle-orm";
import { db, organizations, creditBalances, creditLedger, invoices, subscriptions } from "@athena/db";
import { PLANS } from "@athena/core";
import { SettingsShell } from "@/components/settings-shell";
import { getSettingsContext } from "@/lib/settings-context";

export const metadata = { title: "Settings — Billing" };

export default async function BillingSettingsPage() {
  const s = await getSettingsContext();
  if (!s.can("billing:read")) {
    return (
      <SettingsShell active="billing" title="Billing Settings">
        <p className="text-sm text-gray-500">You need billing access to view this page. Ask an owner or billing admin.</p>
      </SettingsShell>
    );
  }
  const orgId = s.organizationId;
  const [[org], [bal], [sub], ledger, invoiceRows] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)),
    db
      .select()
      .from(creditBalances)
      .where(and(eq(creditBalances.organizationId, orgId), isNull(creditBalances.websiteId), isNull(creditBalances.groupId))),
    db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId)).orderBy(desc(subscriptions.createdAt)).limit(1),
    db.select().from(creditLedger).where(eq(creditLedger.organizationId, orgId)).orderBy(desc(creditLedger.createdAt)).limit(20),
    db.select().from(invoices).where(eq(invoices.organizationId, orgId)).orderBy(desc(invoices.issuedAt)).limit(20),
  ]);
  const plan = PLANS[org?.plan ?? "free"];

  return (
    <SettingsShell active="billing" title="Billing Settings" subtitle="Plan, credits, ledger and invoices">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card">
            <div className="text-xs text-gray-500">Plan</div>
            <div className="mt-1 text-lg font-semibold">{plan.label}</div>
            <div className="text-xs text-gray-400">
              {plan.priceMonthlyUsd ? `$${plan.priceMonthlyUsd}/mo` : org?.plan === "enterprise" ? "Custom" : "Free"} · {plan.models.length} AI models
            </div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-500">Credit balance</div>
            <div className="mt-1 text-lg font-semibold">{(bal?.balance ?? 0).toLocaleString()}</div>
            <div className="text-xs text-gray-400">1 credit = 1 AI response</div>
          </div>
          <div className="metric-card">
            <div className="text-xs text-gray-500">Monthly allowance</div>
            <div className="mt-1 text-lg font-semibold">{(sub?.monthlyCredits ?? plan.monthlyCredits).toLocaleString()}</div>
            <div className="text-xs text-gray-400">Status: {sub?.status ?? "active"}</div>
          </div>
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Credit ledger</h2>
          {ledger.length === 0 ? (
            <p className="text-xs text-gray-400">No credit activity yet.</p>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th className="text-right">Credits</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="text-gray-500">{l.createdAt.toISOString().slice(0, 10)}</td>
                    <td>{l.kind}</td>
                    <td className="text-gray-500">{l.reason}</td>
                    <td className={`text-right font-medium ${l.amount < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {l.amount > 0 ? "+" : ""}
                      {l.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Invoices</h2>
          {invoiceRows.length === 0 ? (
            <p className="text-xs text-gray-400">No invoices yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 text-sm">
              {invoiceRows.map((i) => (
                <li key={i.id} className="flex justify-between px-4 py-2">
                  <span>{i.issuedAt?.toISOString().slice(0, 10) ?? "—"}</span>
                  <span>
                    {(i.amountCents / 100).toFixed(2)} {i.currency.toUpperCase()} · {i.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SettingsShell>
  );
}
