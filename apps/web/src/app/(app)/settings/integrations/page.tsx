import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, publishTargets, apiKeys } from "@athena/db";
import { getIntegration } from "@athena/core/integrations";
import { getSlackConnection } from "@athena/core/reports";
import { targetConfigured } from "@athena/core/content";
import { SlackConnectForm } from "@/components/slack-connect-form";
import { gscConfigured } from "@/lib/integrations";
import { SettingsShell } from "@/components/settings-shell";
import { getSettingsContext } from "@/lib/settings-context";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Settings — Integrations") };
}

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
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const [gsc, targets, slack, [keys]] = await Promise.all([
    getIntegration(db, s.websiteId, "gsc"),
    db.select({ provider: publishTargets.provider, config: publishTargets.config }).from(publishTargets).where(eq(publishTargets.websiteId, s.websiteId)),
    getSlackConnection(db, { actorId: s.user.id, websiteId: s.websiteId }),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(and(eq(apiKeys.organizationId, s.organizationId), isNull(apiKeys.revokedAt))),
  ]);
  const connectedCms = new Set(targets.filter((t) => targetConfigured(t.provider, t.config)).map((t) => t.provider));
  const hasKey = (keys?.n ?? 0) > 0;

  const groups: { title: string; hint: string; items: Item[] }[] = [
    {
      title: "Measure",
      hint: "Traffic and search performance",
      items: [
        {
          name: "Google Search Console",
          connected: gsc?.status === "connected",
          href: gscConfigured() ? `/api/integrations/gsc/connect?websiteId=${s.websiteId}` : undefined,
          note: gsc?.status === "connected" ? gsc.externalAccount ?? undefined : gscConfigured() ? undefined : "Google OAuth is not configured on this server",
        },
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
      ],
    },
  ];

  return (
    <SettingsShell active="integrations" title={tt("Integrations Settings")} subtitle={tt("Connections for {0}", { 0: s.website.name })}>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-sm font-semibold text-gray-900">{tt(g.title)}</h2>
            <p className="mb-3 text-xs text-gray-400">{tt(g.hint)}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {g.items.map((i) => (
                <div key={i.name} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                  <div>
                    <div className="text-sm text-gray-700">{i.name}</div>
                    {i.note ? <div className="text-[11px] text-gray-400">{tt(i.note)}</div> : null}
                  </div>
                  {i.connected ? (
                    <span className="badge bg-emerald-50 text-emerald-700">{tt("Connected")}</span>
                  ) : i.href ? (
                    <Link href={i.href} className="btn-secondary !px-3 !py-1 text-xs">
                      {tt("Set up")}</Link>
                  ) : (
                    <span className="badge bg-gray-100 text-gray-500">{tt("Not connected")}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        <section>
          <h2 className="text-sm font-semibold text-gray-900">{tt("Notify")}</h2>
          <p className="mb-3 text-xs text-gray-400">{tt("Where scheduled reports are posted")}</p>
          <SlackConnectForm connected={slack.connected} channel={slack.channel} canWrite={s.can("websites:write")} />
        </section>
      </div>
    </SettingsShell>
  );
}
