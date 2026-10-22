import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, websites } from "@athena/db";
import { visibilityForSite } from "@athena/core/analytics";
import { authenticate, isResponse } from "@/lib/api-key";
import { resolveApiWebsite, type ApiWebsite } from "@/lib/api-website";

const DAY = 86_400_000;
const PROVIDERS = ["looker-studio", "power-bi"] as const;

export interface BiConnectorRow {
  date: string;
  website_id: string;
  website_name: string;
  domain: string;
  mention_rate: number;
  citation_rate: number;
  share_of_voice: number;
  avg_position: number | null;
  responses_count: number;
  estimated_monthly_value_usd: number;
}

/**
 * GET /api/v1/connectors/{looker-studio|power-bi}?websiteId=&days=30&format=json|csv
 * Native BI Connector feed for Google Looker Studio Community Connector and Microsoft Power BI Web.Contents.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;

  const { provider } = await params;
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: "Unsupported BI connector provider. Use looker-studio or power-bi." },
      { status: 404 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const websiteIdParam = sp.get("websiteId")?.trim();
  const days = Math.min(Math.max(Number.parseInt(sp.get("days") ?? "14", 10) || 14, 1), 90);
  const format = (sp.get("format") ?? "json").toLowerCase();

  let targetSites: ApiWebsite[] = [];
  if (websiteIdParam) {
    const resolved = await resolveApiWebsite(ctx, websiteIdParam);
    if (resolved instanceof NextResponse) return resolved;
    targetSites = [resolved];
  } else {
    targetSites = await db
      .select()
      .from(websites)
      .where(and(eq(websites.organizationId, ctx.organizationId), isNull(websites.deletedAt)))
      .orderBy(asc(websites.name));
  }

  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);

  const rows: BiConnectorRow[] = [];
  for (const site of targetSites) {
    const vis = await visibilityForSite(db, site, { from, to: now });
    for (const d of vis.daily) {
      const estVal = Math.round((d.citationRate * 18.5 + d.mentionRate * 6.5) * 12);
      rows.push({
        date: d.date,
        website_id: site.id,
        website_name: site.name,
        domain: site.domain,
        mention_rate: d.mentionRate,
        citation_rate: d.citationRate,
        share_of_voice: d.shareOfVoice,
        avg_position: d.avgPosition,
        responses_count: d.responses,
        estimated_monthly_value_usd: estVal,
      });
    }
  }

  if (format === "csv") {
    const safeCsvCell = (value: string) => {
      const trimmed = value.trimStart();
      const guarded = /^[=+\-@]/.test(trimmed) ? `'${value}` : value;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const header =
      "date,website_id,website_name,domain,mention_rate,citation_rate,share_of_voice,avg_position,responses_count,estimated_monthly_value_usd";
    const lines = rows.map((r) =>
      [
        r.date,
        r.website_id,
        safeCsvCell(r.website_name),
        safeCsvCell(r.domain),
        r.mention_rate,
        r.citation_rate,
        r.share_of_voice,
        r.avg_position ?? "",
        r.responses_count,
        r.estimated_monthly_value_usd,
      ].join(","),
    );
    return new NextResponse([header, ...lines].join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="athenum-${provider}-feed.csv"`,
      },
    });
  }

  if (provider === "looker-studio") {
    return NextResponse.json({
      connector: "looker-studio",
      version: "1.0",
      schema: [
        { name: "date", label: "Date", dataType: "STRING", semantics: { conceptType: "DIMENSION", semanticType: "YEAR_MONTH_DAY" } },
        { name: "website_id", label: "Website ID", dataType: "STRING", semantics: { conceptType: "DIMENSION" } },
        { name: "website_name", label: "Brand Name", dataType: "STRING", semantics: { conceptType: "DIMENSION" } },
        { name: "domain", label: "Domain", dataType: "STRING", semantics: { conceptType: "DIMENSION" } },
        { name: "mention_rate", label: "Mention Rate (%)", dataType: "NUMBER", semantics: { conceptType: "METRIC" } },
        { name: "citation_rate", label: "Citation Rate (%)", dataType: "NUMBER", semantics: { conceptType: "METRIC" } },
        { name: "share_of_voice", label: "Share of Voice (%)", dataType: "NUMBER", semantics: { conceptType: "METRIC" } },
        { name: "avg_position", label: "Avg Position", dataType: "NUMBER", semantics: { conceptType: "METRIC" } },
        { name: "responses_count", label: "AI Responses", dataType: "NUMBER", semantics: { conceptType: "METRIC" } },
        { name: "estimated_monthly_value_usd", label: "Est. Monthly Value (USD)", dataType: "NUMBER", semantics: { conceptType: "METRIC" } },
      ],
      rows,
      meta: {
        organizationId: ctx.organizationId,
        days,
        totalRows: rows.length,
      },
    });
  }

  return NextResponse.json({
    "@odata.context": `${req.nextUrl.origin}/api/v1/connectors/power-bi/$metadata#AiVisibilityDaily`,
    connector: "power-bi",
    version: "1.0",
    value: rows,
    meta: {
      organizationId: ctx.organizationId,
      days,
      totalRows: rows.length,
    },
  });
}
