import { SettingsShell } from "@/components/settings-shell";
import { getSettingsContext } from "@/lib/settings-context";
import { providerInfo } from "@/lib/auth";
import { signOutEverywhere } from "../actions";

export const metadata = { title: "Settings — Security" };

export default async function SecuritySettingsPage() {
  await getSettingsContext();
  return (
    <SettingsShell active="security" title="Sign-in & access" subtitle="Authentication methods and session control">
      <div className="space-y-4">
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">Enabled sign-in methods</div>
          {providerInfo.length ? (
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {providerInfo.map((p) => (
                <li key={p.id}>✓ {p.label}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-gray-400">No providers configured.</p>
          )}
        </div>
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">Sign out everywhere</div>
          <p className="mt-1 text-xs text-gray-500">
            Immediately invalidates every session for your account, including this one, on all devices.
          </p>
          <form action={signOutEverywhere} className="mt-3">
            <button type="submit" className="btn-secondary text-xs">
              Sign out of all sessions
            </button>
          </form>
        </div>
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">SAML / OIDC SSO</div>
          <p className="mt-1 text-xs text-gray-500">Single sign-on enforcement is available on the Enterprise plan.</p>
        </div>
      </div>
    </SettingsShell>
  );
}
