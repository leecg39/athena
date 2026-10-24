import { getTranslations } from "@/lib/i18n/server";
import { SettingsShell } from "@/components/settings-shell";
import { getSettingsContext } from "@/lib/settings-context";
import { providerInfo } from "@/lib/auth";
import { signOutEverywhere } from "../actions";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Settings — Security") };
}

export default async function SecuritySettingsPage() {
  const tt = await getTranslations();
  await getSettingsContext();
  return (
    <SettingsShell active="security" title={tt("Sign-in & access")} subtitle={tt("Authentication methods and session control")}>
      <div className="space-y-4">
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">{tt("Enabled sign-in methods")}</div>
          {providerInfo.length ? (
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {providerInfo.map((p) => (
                <li key={p.id}>✓ {tt(p.label)}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-gray-400">{tt("No providers configured.")}</p>
          )}
        </div>
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">{tt("Sign out everywhere")}</div>
          <p className="mt-1 text-xs text-gray-500">
            {tt("Immediately invalidates every session for your account, including this one, on all devices.")}</p>
          <form action={signOutEverywhere} className="mt-3">
            <button type="submit" className="btn-secondary text-xs">
              {tt("Sign out of all sessions")}</button>
          </form>
        </div>
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">{tt("SAML / OIDC SSO")}</div>
          <p className="mt-1 text-xs text-gray-500">{tt("Single sign-on enforcement is available on the Enterprise plan.")}</p>
        </div>
      </div>
    </SettingsShell>
  );
}
