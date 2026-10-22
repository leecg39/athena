import { SettingsShell } from "@/components/settings-shell";

export const metadata = { title: "Settings — Security" };

export default function SecuritySettingsPage() {
  return (
    <SettingsShell active="security" title="Sign-in & access" subtitle="Authentication methods, SSO and session policy">
      <div className="space-y-4">
        <div className="metric-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">SAML / OIDC SSO</div>
              <div className="text-xs text-gray-400">Enterprise feature — enforce single sign-on for your domain.</div>
            </div>
            <button className="btn-secondary text-xs" disabled>
              Configure (Enterprise)
            </button>
          </div>
        </div>
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">Sign-in methods</div>
          <ul className="mt-2 space-y-1 text-xs text-gray-500">
            <li>✔ Google OAuth</li>
            <li>✔ Microsoft Entra ID</li>
            <li>✔ Email magic link</li>
          </ul>
        </div>
        <div className="metric-card">
          <div className="text-sm font-semibold text-gray-900">Active sessions</div>
          <div className="mt-2 text-xs text-gray-400">1 active session — this device.</div>
          <button className="btn-secondary mt-3 text-xs">Revoke all sessions</button>
        </div>
      </div>
    </SettingsShell>
  );
}
