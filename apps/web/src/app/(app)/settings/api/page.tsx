import { SettingsShell } from "@/components/settings-shell";

export const metadata = { title: "Settings — API & Embed" };

export default function ApiSettingsPage() {
  return (
    <SettingsShell active="api" title="API & Embed Settings" subtitle="API keys, MCP connections and embeddable dashboards">
      <div className="space-y-4">
        <div className="metric-card">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">API keys</span>
            <button className="btn-primary text-xs">+ Create key</button>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-500">ah_live_••••••••••••••••••••</div>
          <p className="mt-2 text-xs text-gray-400">
            Base URL: <code className="font-mono">/api/v1</code> · Rate limit: 60 req/min · Docs at <code className="font-mono">/docs</code>
          </p>
        </div>
        <div className="metric-card">
          <div className="mb-2 text-sm font-semibold text-gray-900">MCP (ChatGPT / Claude)</div>
          <div className="rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-500">
            {`{ "mcpServers": { "athenum": { "url": "https://mcp.example.com", "headers": { "Authorization": "Bearer <key>" } } } }`}
          </div>
          <p className="mt-2 text-xs text-gray-400">Read AI-search data and create content from ChatGPT or Claude via MCP.</p>
        </div>
        <div className="metric-card">
          <div className="mb-2 text-sm font-semibold text-gray-900">BI connectors</div>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs">Looker Studio</button>
            <button className="btn-secondary text-xs">Power BI / Fabric</button>
          </div>
        </div>
      </div>
    </SettingsShell>
  );
}
