import { db } from "@athena/db";
import { listApiKeys } from "@athena/core/org";
import { SettingsShell } from "@/components/settings-shell";
import { ActionForm } from "@/components/action-form";
import { getSettingsContext } from "@/lib/settings-context";
import { appBaseUrl } from "@/lib/email";
import { addApiKey, disableApiKey } from "../actions";

export const metadata = { title: "Settings — API, MCP & BI Connectors" };
export const dynamic = "force-dynamic";

const API_ENDPOINTS = [
  {
    surface: "basics",
    method: "GET",
    path: "/api/v1/basics/{topics|competitors|personas|locations|tags|schedules}?websiteId=…",
    description: "Taxonomy entities, competitors, personas, locations, tags & schedules.",
  },
  {
    surface: "metrics",
    method: "GET",
    path: "/api/v1/metrics/{share-of-voice|mention-rate|citation-rate|position}?websiteId=…&window=cumulative|over-time",
    description: "Cumulative or daily AI search visibility metrics and competitor Share of Voice.",
  },
  {
    surface: "sources",
    method: "GET",
    path: "/api/v1/sources?websiteId=…&type=c|t|o|p&limit=50",
    description: "Cited root domains ranking, citation %, brand/competitor mention %, and 7d sparklines.",
  },
  {
    surface: "content",
    method: "GET / POST",
    path: "/api/v1/content?websiteId=…",
    description: "List active Content Hub items or create a prompt-grounded AEO content brief.",
  },
  {
    surface: "kb",
    method: "GET / POST",
    path: "/api/v1/kb?websiteId=…&section=all|pillars|facts|oracle",
    description: "Read or create Knowledge Base pillars, canonical brand facts & Oracle findings.",
  },
  {
    surface: "billing",
    method: "GET",
    path: "/api/v1/billing/credits?scope=all|organization|website|group",
    description: "Multi-scope credit balances (org/website/group), ledger entries & invoices.",
  },
  {
    surface: "teams",
    method: "GET",
    path: "/api/v1/teams",
    description: "Organization members, portfolio groups, tracked websites & custom RBAC roles.",
  },
  {
    surface: "connectors",
    method: "GET",
    path: "/api/v1/connectors/{looker-studio|power-bi}?websiteId=…&days=14&format=json|csv",
    description: "Native BI Connector feeds for Google Looker Studio and Microsoft Power BI.",
  },
  {
    surface: "streaming",
    method: "POST / GET",
    path: "/api/v1/response-streaming · /api/v1/response-streaming/status?runId=…",
    description: "Trigger on-demand AI response collection runs and poll live completion progress.",
  },
];

export default async function ApiSettingsPage() {
  const s = await getSettingsContext();
  if (!s.can("api:manage")) {
    return (
      <SettingsShell active="api" title="API, MCP & BI Connectors">
        <p className="text-sm text-gray-500">Only owners and admins can manage API keys.</p>
      </SettingsShell>
    );
  }

  const keys = await listApiKeys(db, {
    actorId: s.user.id,
    organizationId: s.organizationId,
  });
  const base = await appBaseUrl();

  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        athenum: {
          command: "node",
          args: ["apps/mcp/dist/index.js"],
          env: {
            ATHENUM_API_URL: base,
            ATHENUM_API_KEY: "ath_<your_api_key>",
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <SettingsShell
      active="api"
      title="API, MCP & BI Connectors"
      subtitle="Manage Bearer API keys, /api/v1 REST endpoints, ChatGPT/Claude MCP Server, and Looker Studio / Power BI feeds"
    >
      <div className="space-y-6">
        {/* Section 1: API Keys & Rate Limits */}
        <section className="metric-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Organization API Keys</h2>
              <p className="text-xs text-gray-500">
                Authenticate via <code className="font-mono">Authorization: Bearer ath_…</code> or{" "}
                <code className="font-mono">X-API-Key: ath_…</code> · Token-bucket rate limit:{" "}
                <strong>60 requests / minute</strong> per key.
              </p>
            </div>
            <span className="badge bg-brand-50 font-mono text-xs text-brand-700">
              Rate Limit: 60 req/min
            </span>
          </div>

          {keys.length === 0 ? (
            <p className="text-xs text-gray-400">No API keys created yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key Prefix</th>
                    <th>Last Used</th>
                    <th className="text-right">Status / Action</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td className="font-medium text-gray-900">{k.name}</td>
                      <td className="font-mono text-xs text-gray-500">{k.prefix}…</td>
                      <td className="font-mono text-xs text-gray-500">
                        {k.lastUsedAt
                          ? k.lastUsedAt.toISOString().slice(0, 16).replace("T", " ")
                          : "never"}
                      </td>
                      <td className="text-right">
                        {k.revokedAt ? (
                          <span className="badge bg-gray-100 text-gray-500">revoked</span>
                        ) : (
                          <ActionForm
                            action={disableApiKey}
                            submitLabel="Revoke"
                            variant="secondary"
                            confirm={`Revoke ${k.name}?`}
                          >
                            <input type="hidden" name="keyId" value={k.id} />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ActionForm
            action={addApiKey}
            submitLabel="Create API Key"
            className="flex flex-wrap items-center gap-2"
          >
            <input
              name="name"
              className="input-base !w-72 text-xs"
              placeholder="Key name, e.g. Looker Studio / Claude MCP"
              required
              maxLength={60}
            />
          </ActionForm>
        </section>

        {/* Section 2: Public REST API /api/v1 Surface Reference */}
        <section className="metric-card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Public REST API Surface (<code className="font-mono">{base}/api/v1</code>)
              </h2>
              <p className="text-xs text-gray-500">
                Full programmatic coverage across basics, metrics, sources, content, kb, billing,
                teams, and BI connectors. Active Workspace ID:{" "}
                <code className="font-mono text-brand-700">{s.websiteId}</code>
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Surface</th>
                  <th>Method</th>
                  <th>Endpoint Contract</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {API_ENDPOINTS.map((ep) => (
                  <tr key={ep.surface}>
                    <td>
                      <span className="badge bg-brand-50 font-mono text-xs text-brand-700">
                        {ep.surface}
                      </span>
                    </td>
                    <td className="font-mono text-xs font-semibold text-gray-700">{ep.method}</td>
                    <td className="font-mono text-[11px] text-gray-800">{ep.path}</td>
                    <td className="text-xs text-gray-600">{ep.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: MCP Server (ChatGPT / Claude Integration) & BI Connectors */}
        <div className="grid gap-6 md:grid-cols-2">
          <section className="metric-card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                MCP Server (Claude Desktop &amp; ChatGPT)
              </h2>
              <span className="badge bg-purple-50 text-xs font-semibold text-purple-700">
                14 MCP Tools
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Connect Claude Desktop, Cursor, or ChatGPT MCP to query live AI search metrics,
              Knowledge Base facts, and trigger content briefs via stdio transport.
            </p>
            <div className="rounded-lg bg-gray-900 p-3 text-gray-100">
              <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-emerald-300">
                {mcpConfigJson}
              </pre>
            </div>
          </section>

          <section className="metric-card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Looker Studio &amp; Power BI Connectors
              </h2>
              <span className="badge bg-emerald-50 text-xs font-semibold text-emerald-700">
                JSON / OData / CSV
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Stream daily AI Mention Rate, Citation Authority, Share of Voice, and Estimated Search
              Value directly into your BI dashboards using <code className="font-mono">X-API-Key</code>{" "}
              or <code className="font-mono">Authorization: Bearer</code>.
            </p>

            <div className="space-y-2.5 text-xs">
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="font-semibold text-gray-900">
                  1. Google Looker Studio Community Connector Feed (JSON Schema + Rows)
                </div>
                <div className="mt-1 break-all font-mono text-[11px] text-brand-700">
                  {base}/api/v1/connectors/looker-studio?websiteId={s.websiteId}&amp;days=30
                </div>
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="font-semibold text-gray-900">
                  2. Microsoft Power BI Web.Contents Feed (OData JSON / CSV)
                </div>
                <div className="mt-1 break-all font-mono text-[11px] text-brand-700">
                  {base}/api/v1/connectors/power-bi?websiteId={s.websiteId}&amp;days=30&amp;format=csv
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </SettingsShell>
  );
}
