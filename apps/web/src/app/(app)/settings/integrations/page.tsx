import Link from "next/link";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, publishTargets, scheduledReports, apiKeys } from "@athena/db";
import { SettingsShell } from "@/components/settings-shell";
import { getSettingsContext } from "@/lib/settings-context";

export const metadata = { title: "Settings — Integrations" };

interface Item {
  name: string;
  connected: boolean;
  /** where the connection is configured */
  href?: string;
  note?: string;
}

const CMS = ["wordpress", "shopify", "webflow", "contentful", "sanity", "framer", "wix", "payload"] as const;
const CMS_LABEL: Record<(typeof CMS)[number], string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  webflow: "Webflow",
  contentful: "Contentful",
  sanity: "Sanity",
  framer: "Framer",
  wix: "Wix",
  payload: "Payload CMS",
};

export default async function IntegrationsSettingsPage() {
  const s = await getSettingsContext();
  const [targets, [slack], [keys]] = await Promise.all([
    db.select({ provider: publishTargets.provider }).from(publishTargets).where(eq(publishTargets.websiteId, s.websiteId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(scheduledReports)
      .where(and(eq(scheduledReports.websiteId, s.websiteId), isNotNull(scheduledReports.slackChannel))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(and(eq(apiKeys.organizationId, s.organizationId), isNull(apiKeys.revokedAt))),
  ]);
  const connectedCms = new Set(targets.map((t) => t.provider));
  const hasKey = (keys?.n ?? 0) > 0;

  const groups: { title: string; hint: string; items: Item[] }[] = [
    {
      title: "Measure",
      hint: "Traffic and search performance",
      items: [
        { name: "Google Search Console", connected: false, note: "OAuth connection not configured" },
        { name: "Google Analytics 4", connected: false, note: "OAuth connection not configured" },
      ],
    },
    {
      title: "Publish",
      hint: "Send content to your CMS",
      items: CMS.map((c) => ({ name: CMS_LABEL[c], connected: connectedCms.has(c), href: "/content" })),
    },
    {
      title: "Extend",
      hint: "Use your data in other tools",
      items: [
        { name: "REST API / MCP / Looker Studio", connected: hasKey, href: "/settings/api", note: hasKey ? undefined : "Create an API key" },
        { name: "Slack weekly report", connected: (slack?.n ?? 0) > 0, href: "/reports" },
      ],
    },
  ];

  return (
    <SettingsShell active="integrations" title="Integrations Settings" subtitle={`Connections for ${s.website.name}`}>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-sm font-semibold text-gray-900">{g.title}</h2>
            <p className="mb-3 text-xs text-gray-400">{g.hint}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {g.items.map((i) => (
                <div key={i.name} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                  <div>
                    <div className="text-sm text-gray-700">{i.name}</div>
                    {i.note ? <div className="text-[11px] text-gray-400">{i.note}</div> : null}
                  </div>
                  {i.connected ? (
                    <span className="badge bg-emerald-50 text-emerald-700">Connected</span>
                  ) : i.href ? (
                    <Link href={i.href} className="btn-secondary !px-3 !py-1 text-xs">
                      Set up
                    </Link>
                  ) : (
                    <span className="badge bg-gray-100 text-gray-500">Not connected</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SettingsShell>
  );
}
