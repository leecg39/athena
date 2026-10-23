/** Commerce types and helpers shared by shopping insights and sponsored placements. */

export const AD_SURFACES = ["chatgpt", "ai_mode", "ai_overview"] as const;
export type AdSurface = (typeof AD_SURFACES)[number];

export const AD_SURFACE_LABELS: Record<AdSurface, string> = {
  chatgpt: "ChatGPT",
  ai_mode: "AI Mode",
  ai_overview: "AI Overview",
};

export interface ShoppingProductItem {
  id: string;
  websiteId: string;
  title: string;
  brand: string;
  retailer: string;
  price: number;
  appearances: number;
  sharePct: number;
  avgPosition: number;
  isOwn: boolean;
  pricePositioning: "below_market" | "at_market" | "above_market";
  lastSeenAt: Date | null;
}

export interface ShoppingBrandComparison {
  brand: string;
  isOwn: boolean;
  productCount: number;
  appearances: number;
  sharePct: number;
  avgPosition: number;
  avgPrice: number;
  topRetailer: string;
}

export interface ShoppingRetailerDistribution {
  retailer: string;
  totalAppearances: number;
  ownAppearances: number;
  competitorAppearances: number;
  sharePct: number;
  ownShareWithinRetailerPct: number;
  productCount: number;
  avgPrice: number;
}

export interface ShoppingInsightsSummary {
  stats: {
    totalAppearances: number;
    ownAppearances: number;
    competitorAppearances: number;
    ownSharePct: number;
    ownAvgPosition: number;
    competitorAvgPosition: number;
    overallAvgPosition: number;
    ownAvgPrice: number;
    competitorAvgPrice: number;
    marketAvgPrice: number;
    priceDeltaPct: number;
    retailerCoverageCount: number;
    ownRetailerCount: number;
    totalProducts: number;
    ownProductCount: number;
    competitorProductCount: number;
  };
  products: ShoppingProductItem[];
  brandComparison: ShoppingBrandComparison[];
  retailerDistribution: ShoppingRetailerDistribution[];
  retailers: string[];
}

export interface AdImpressionItem {
  id: string;
  websiteId: string;
  promptId: string | null;
  promptText: string | null;
  topicName: string | null;
  surface: AdSurface;
  surfaceLabel: string;
  advertiser: string;
  isOwn: boolean;
  adText: string;
  seenAt: Date;
}

export interface AdvertiserBreakdownItem {
  advertiser: string;
  isOwn: boolean;
  impressions: number;
  sharePct: number;
  surfaces: AdSurface[];
}

export interface AdsSummary {
  stats: {
    totalImpressions: number;
    surfaceCounts: Record<AdSurface, number>;
    uniqueAdvertisers: number;
    ownAdCount: number;
    competitorAdCount: number;
    promptsWithAdsCount: number;
  };
  advertiserBreakdown: AdvertiserBreakdownItem[];
  impressions: AdImpressionItem[];
  advertisers: string[];
  prompts: { id: string; text: string }[];
}

/**
 * Strips optimization suffixes (e.g. ` — Verified AI Collaborative Suite`) so
 * products optimized in Catalog Optimization match their base product key.
 */
export function baseTitleKey(title: string): string {
  const base = title.split(/\s+[—–]\s+/)[0] ?? title;
  return base.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function inferBrandFromTitle(title: string, siteName: string, competitorNames: string[]): { brand: string; isOwn: boolean } {
  const lower = title.toLowerCase();
  if (lower.includes(siteName.toLowerCase())) {
    return { brand: siteName, isOwn: true };
  }
  for (const comp of competitorNames) {
    if (lower.includes(comp.toLowerCase())) {
      return { brand: comp, isOwn: false };
    }
  }
  const firstWord = title.trim().split(/\s+/)[0] || "Competitor";
  return { brand: firstWord, isOwn: false };
}

/**
 * Synchronizes own-brand and competitor products into `shopping_products`.
 * Preserves existing user-edited or catalog-optimized own product titles and prices.
 */
