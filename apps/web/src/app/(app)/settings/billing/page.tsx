import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { BILLING_PLAN_CATALOG, getBillingOverview } from "@athena/core/billing";
import { SettingsShell } from "@/components/settings-shell";
import { BillingSettingsView } from "@/components/billing-settings-view";
import { getSettingsContext } from "@/lib/settings-context";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Settings — Billing") };
}
export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  if (!s.can("billing:read")) {
    return (
      <SettingsShell active="billing" title={tt("Billing Settings")}>
        <p className="text-sm text-gray-500">
          {tt("You need billing access to view this page. Ask an owner or billing admin.")}</p>
      </SettingsShell>
    );
  }

  const overview = await getBillingOverview(db, {
    actorId: s.user.id,
    organizationId: s.organizationId,
  });

  const plans = [
    BILLING_PLAN_CATALOG.free,
    BILLING_PLAN_CATALOG.starter,
    BILLING_PLAN_CATALOG.enterprise,
  ];

  return (
    <SettingsShell
      active="billing"
      title={tt("Billing Settings")}
      subtitle={tt("Subscription plans (Free / Starter $295 / Enterprise), multi-scope credit pools, add-ons, ledger and invoices")}
    >
      <BillingSettingsView
        overview={overview}
        plans={plans}
        canWriteBilling={s.can("billing:write")}
      />
    </SettingsShell>
  );
}
