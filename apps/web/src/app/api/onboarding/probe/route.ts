import { NextRequest, NextResponse } from "next/server";
import { crawlSite } from "@athena/crawler";

/** Onboarding probe: crawl a site and suggest brand profile, competitors and prompts. */
export async function GET(req: NextRequest) {
  const site = req.nextUrl.searchParams.get("site");
  if (!site) return NextResponse.json({ error: "site required" }, { status: 400 });

  const result = await crawlSite(site);
  const brand = result.suggestion.name;

  const suggestedPrompts = [
    `best ${brand} alternatives`,
    `how does ${brand} work`,
    `${brand} pricing and features`,
    `top tools for ${result.suggestion.productHints[0]?.toLowerCase().slice(0, 30) || "product teams"}`,
    `is ${brand} worth it`,
  ];

  return NextResponse.json({
    domain: result.suggestion.domain,
    name: brand,
    description: result.suggestion.description,
    headlines: result.suggestion.headlines,
    aiAccess: result.aiAccess,
    sitemapCount: result.sitemapUrls.length,
    suggestedCompetitors: ["figma.com", "canva.com", "adobe.com"],
    suggestedPrompts,
  });
}
