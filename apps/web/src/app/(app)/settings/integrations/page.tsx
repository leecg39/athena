import { SettingsShell } from "@/components/settings-shell";

export const metadata = { title: "Settings — Integrations" };

const GROUPS: { title: string; hint: string; items: { name: string; connected: boolean }[] }[] = [
  {
    title: "Measure",
    hint: "Check your traffic and search performance",
    items: [
      { name: "Google Analytics 4", connected: false },
      { name: "Google Search Console", connected: false },
      { name: "Google Ads", connected: false },
    ],
  },
  {
    title: "Publish",
    hint: "Send articles to your CMS without leaving Athenum",
    items: [
      { name: "WordPress", connected: false },
      { name: "Shopify", connected: false },
      { name: "Webflow", connected: false },
      { name: "Contentful", connected: false },
      { name: "Sanity", connected: false },
      { name: "Framer", connected: false },
      { name: "Wix", connected: false },
      { name: "Payload CMS", connected: false },
    ],
  },
  {
    title: "Extend",
    hint: "Work with your data in other tools",
    items: [
      { name: "MCP — ChatGPT", connected: false },
      { name: "MCP — Claude", connected: false },
      { name: "Looker Studio", connected: false },
      { name: "Slack reports", connected: false },
    ],
  },
];

export default function IntegrationsSettingsPage() {
  return (
    <SettingsShell active="integrations" title="Integrations Settings" subtitle="Connect analytics, CMS, dashboards and AI assistants">
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 text-sm font-semibold text-gray-900">{g.title}</div>
            <div className="mb-3 text-xs text-gray-400">{g.hint}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {g.items.map((i) => (
                <div key={i.name} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                  <span className="text-sm text-gray-700">{i.name}</span>
                  <button className={`text-xs ${i.connected ? "text-emerald-600" : "btn-secondary !px-3 !py-1"}`}>
                    {i.connected ? "Connected ✓" : "Connect"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SettingsShell>
  );
}
