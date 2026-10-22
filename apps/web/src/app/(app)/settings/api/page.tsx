import { db } from "@athena/db";
import { listApiKeys } from "@athena/core/org";
import { SettingsShell } from "@/components/settings-shell";
import { ActionForm } from "@/components/action-form";
import { getSettingsContext } from "@/lib/settings-context";
import { appBaseUrl } from "@/lib/email";
import { addApiKey, disableApiKey } from "../actions";

export const metadata = { title: "Settings — API & Embed" };

export default async function ApiSettingsPage() {
  const s = await getSettingsContext();
  if (!s.can("api:manage")) {
    return (
      <SettingsShell active="api" title="API & Embed Settings">
        <p className="text-sm text-gray-500">Only owners and admins can manage API keys.</p>
      </SettingsShell>
    );
  }
  const keys = await listApiKeys(db, { actorId: s.user.id, organizationId: s.organizationId });
  const base = await appBaseUrl();
  return (
    <SettingsShell active="api" title="API & Embed Settings" subtitle="API keys for the REST API, MCP and BI connectors">
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">API keys</h2>
          {keys.length === 0 ? (
            <p className="mb-3 text-xs text-gray-400">No keys yet.</p>
          ) : (
            <table className="table-base mb-4">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="font-mono text-xs text-gray-500">{k.prefix}…</td>
                    <td className="text-xs text-gray-500">{k.lastUsedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "never"}</td>
                    <td className="text-right">
                      {k.revokedAt ? (
                        <span className="badge bg-gray-100 text-gray-500">revoked</span>
                      ) : (
                        <ActionForm action={disableApiKey} submitLabel="Revoke" variant="secondary" confirm={`Revoke ${k.name}?`}>
                          <input type="hidden" name="keyId" value={k.id} />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ActionForm action={addApiKey} submitLabel="Create key" className="flex flex-wrap items-center gap-2">
            <input name="name" className="input !w-64" placeholder="Key name, e.g. Looker Studio" required maxLength={60} />
          </ActionForm>
        </section>
        <section className="metric-card">
          <div className="text-sm font-semibold text-gray-900">REST API</div>
          <p className="mt-1 text-xs text-gray-500">
            Base URL <code className="font-mono">{base}/api/v1</code> · header <code className="font-mono">Authorization: Bearer ath_…</code> · 60 requests/minute per key.
          </p>
        </section>
      </div>
    </SettingsShell>
  );
}
