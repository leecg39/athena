/**
 * Shopping insights from the product cards AI answers actually show: own vs
 * competitor appearances, positions, prices and retailers. Nothing is seeded;
 * viewing never writes.
 */
import { z } from "zod";
import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { type Db, competitors, responses, shoppingProducts, websites } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { aliasesFor, detectShoppingCards, findMentions } from "../extract";
import { baseTitleKey, inferBrandFromTitle, type ShoppingBrandComparison, type ShoppingInsightsSummary, type ShoppingProductItem, type ShoppingRetailerDistribution } from "./shared";

/** answers scanned per sync (oldest first so the latest price wins) */
const MAX_ANSWERS = 5_000;
const DAY = 86_400_000;

interface Observed {
  title: string;
  appearances: number;
  rankSum: number;
  price: number;
  retailers: Map<string, { count: number; lastSeen: number }>;
  lastSeen: Date;
}

const productKey = (title: string) => baseTitleKey(title);

function topRetailer(retailers: Observed["retailers"]): string | null {
  const ranked = [...retailers.entries()].sort((a, b) => b[1].count - a[1].count || b[1].lastSeen - a[1].lastSeen);
  return ranked[0]?.[0] ?? null;
}

/** Product cards in this website's collected answers since `since`, keyed by base title. */
async function observedProducts(db: Db, siteId: string, since: Date): Promise<Map<string, Observed>> {
  const rows = await db
    .select({ text: sql<string>`left(${responses.rawText}, 20000)`, ranAt: responses.ranAt })
    .from(responses)
    .where(and(eq(responses.websiteId, siteId), gte(responses.ranAt, since), isNotNull(responses.shoppingCard)))
    .orderBy(asc(responses.ranAt))
    .limit(MAX_ANSWERS);
  const out = new Map<string, Observed>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const card of detectShoppingCards(row.text)) {
      const key = productKey(card.product);
      if (!key || seen.has(key)) continue; // one appearance per answer
      seen.add(key);
      const prev = out.get(key) ?? { title: card.product, appearances: 0, rankSum: 0, price: card.price, retailers: new Map(), lastSeen: row.ranAt };
      const retailers = new Map(prev.retailers);
      if (card.retailer) retailers.set(card.retailer, { count: (retailers.get(card.retailer)?.count ?? 0) + 1, lastSeen: row.ranAt.getTime() });
      out.set(key, { ...prev, appearances: prev.appearances + 1, rankSum: prev.rankSum + card.rank, price: card.price, retailers, lastSeen: row.ranAt });
    }
  }
  return out;
}

const isOwnProduct = (title: string, site: Pick<WebsiteRow, "name" | "domain">) => findMentions(title, aliasesFor(site.name, site.domain)).length > 0;

/**
 * Shopping products from the product cards in collected answers (a website the
 * caller has ALREADY authorised; users go through syncShoppingInsights).
 * Appearances and positions cover the window; products not seen in it drop to 0.
 */
export async function syncShoppingProductsForSite(db: Db, site: WebsiteRow, opts: { days?: number; actorId?: string } = {}): Promise<{ created: number; updated: number; total: number }> {
  const days = Math.min(90, Math.max(7, opts.days ?? 30));
  const observed = await observedProducts(db, site.id, new Date(Date.now() - days * DAY));
  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx.select().from(shoppingProducts).where(eq(shoppingProducts.websiteId, site.id));
    const byKey = new Map(existing.map((r) => [productKey(r.title), r]));
    let created = 0;
    let updated = 0;
    for (const [key, o] of observed) {
      const values = { appearances: o.appearances, avgPosition: (o.rankSum / o.appearances).toFixed(2), price: o.price.toFixed(2), retailer: topRetailer(o.retailers), lastSeenAt: o.lastSeen };
      const match = byKey.get(key);
      if (match) {
        await tx.update(shoppingProducts).set(values).where(eq(shoppingProducts.id, match.id));
        updated++;
      } else {
        await tx.insert(shoppingProducts).values({ websiteId: site.id, title: o.title, isOwn: isOwnProduct(o.title, site), ...values });
        created++;
      }
    }
    const stale = existing.filter((r) => r.lastSeenAt && r.appearances > 0 && !observed.has(productKey(r.title)));
    for (const r of stale) await tx.update(shoppingProducts).set({ appearances: 0 }).where(eq(shoppingProducts.id, r.id));
    if (opts.actorId && (created || updated)) {
      await logActivity(tx, { organizationId: site.organizationId, websiteId: site.id, userId: opts.actorId, entityType: "shopping_product", entityId: site.id, change: "synced", after: { created, updated } });
    }
    return { created, updated, total: existing.length + created };
  });
}

export async function syncShoppingInsights(db: Db, input: { actorId: string; websiteId: string; days?: number }): Promise<{ created: number; updated: number; total: number }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  return syncShoppingProductsForSite(db, site, { days: input.days, actorId: input.actorId });
}

export async function getShoppingInsightsSummary(
  db: Db,
  input: { actorId: string; websiteId: string; filters?: { ownership?: "all" | "own" | "competitor"; retailer?: string; search?: string } },
): Promise<ShoppingInsightsSummary> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const websiteId = site.id;
  const filters = input.filters;
  // read-only: products are refreshed after collection runs and from the Sync button
  const rows = await db
    .select()
    .from(shoppingProducts)
    .where(eq(shoppingProducts.websiteId, websiteId))
    .orderBy(desc(shoppingProducts.appearances), asc(shoppingProducts.avgPosition));

  const trackedCompetitors = await db
    .select({ name: competitors.name })
    .from(competitors)
    .where(and(eq(competitors.websiteId, websiteId), isNull(competitors.deletedAt)));
  const competitorNames = trackedCompetitors.map((c) => c.name);

  const totalAppearances = rows.reduce((acc, r) => acc + (r.appearances ?? 0), 0);
  const ownRows = rows.filter((r) => r.isOwn);
  const compRows = rows.filter((r) => !r.isOwn);

  const ownAppearances = ownRows.reduce((acc, r) => acc + (r.appearances ?? 0), 0);
  const competitorAppearances = compRows.reduce((acc, r) => acc + (r.appearances ?? 0), 0);
  const ownSharePct = totalAppearances > 0 ? +((ownAppearances / totalAppearances) * 100).toFixed(1) : 0;

  const weightedAvgPos = (items: typeof rows): number => {
    const weightSum = items.reduce((a, r) => a + Math.max(1, r.appearances ?? 1), 0);
    if (weightSum === 0) return 0;
    const weighted = items.reduce(
      (a, r) => a + Number(r.avgPosition ?? 0) * Math.max(1, r.appearances ?? 1),
      0,
    );
    return +(weighted / weightSum).toFixed(2);
  };

  const avgPriceOf = (items: typeof rows): number => {
    const priced = items.map((r) => Number(r.price ?? 0)).filter((p) => p > 0);
    if (priced.length === 0) return 0;
    return +(priced.reduce((a, b) => a + b, 0) / priced.length).toFixed(2);
  };

  const ownAvgPosition = weightedAvgPos(ownRows);
  const competitorAvgPosition = weightedAvgPos(compRows);
  const overallAvgPosition = weightedAvgPos(rows);

  const ownAvgPrice = avgPriceOf(ownRows);
  const competitorAvgPrice = avgPriceOf(compRows);
  const marketAvgPrice = avgPriceOf(rows);
  const priceDeltaPct =
    competitorAvgPrice > 0
      ? +(((ownAvgPrice - competitorAvgPrice) / competitorAvgPrice) * 100).toFixed(1)
      : 0;

  const allRetailers = Array.from(
    new Set(rows.map((r) => (r.retailer ?? "Direct").trim()).filter(Boolean)),
  ).sort();
  const ownRetailers = new Set(
    ownRows.map((r) => (r.retailer ?? "Direct").trim()).filter(Boolean),
  );

  // Build enriched items
  const allItems: ShoppingProductItem[] = rows.map((r) => {
    const price = Number(r.price ?? 0);
    const appearances = r.appearances ?? 0;
    const avgPosition = Number(r.avgPosition ?? 0);
    const retailer = (r.retailer ?? "Direct").trim() || "Direct";
    const inferred = r.isOwn
      ? { brand: site.name, isOwn: true }
      : inferBrandFromTitle(r.title, site.name, competitorNames);

    let pricePositioning: ShoppingProductItem["pricePositioning"] = "at_market";
    if (marketAvgPrice > 0 && price > 0) {
      if (price < marketAvgPrice * 0.9) pricePositioning = "below_market";
      else if (price > marketAvgPrice * 1.1) pricePositioning = "above_market";
    }

    return {
      id: r.id,
      websiteId: r.websiteId,
      title: r.title,
      brand: inferred.brand,
      retailer,
      price,
      appearances,
      sharePct: totalAppearances > 0 ? +((appearances / totalAppearances) * 100).toFixed(1) : 0,
      avgPosition,
      isOwn: r.isOwn,
      pricePositioning,
      lastSeenAt: r.lastSeenAt,
    };
  });

  // Brand comparison aggregation
  const brandGroups = new Map<string, ShoppingProductItem[]>();
  for (const item of allItems) {
    const key = item.isOwn ? `own:${site.name}` : `comp:${item.brand}`;
    const list = brandGroups.get(key) ?? [];
    list.push(item);
    brandGroups.set(key, list);
  }

  const brandComparison: ShoppingBrandComparison[] = Array.from(brandGroups.values())
    .map((group) => {
      const first = group[0]!;
      const appearances = group.reduce((a, i) => a + i.appearances, 0);
      const weightSum = group.reduce((a, i) => a + Math.max(1, i.appearances), 0);
      const avgPosition =
        weightSum > 0
          ? +(group.reduce((a, i) => a + i.avgPosition * Math.max(1, i.appearances), 0) / weightSum).toFixed(2)
          : 0;
      const priced = group.filter((i) => i.price > 0);
      const avgPrice =
        priced.length > 0 ? +(priced.reduce((a, i) => a + i.price, 0) / priced.length).toFixed(2) : 0;

      // Top retailer by appearances
      const retMap = new Map<string, number>();
      for (const i of group) {
        retMap.set(i.retailer, (retMap.get(i.retailer) ?? 0) + i.appearances);
      }
      const topRetailer =
        Array.from(retMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Direct";

      return {
        brand: first.brand,
        isOwn: first.isOwn,
        productCount: group.length,
        appearances,
        sharePct: totalAppearances > 0 ? +((appearances / totalAppearances) * 100).toFixed(1) : 0,
        avgPosition,
        avgPrice,
        topRetailer,
      };
    })
    .sort((a, b) => b.appearances - a.appearances);

  // Retailer distribution aggregation
  const retailerGroups = new Map<string, ShoppingProductItem[]>();
  for (const item of allItems) {
    const list = retailerGroups.get(item.retailer) ?? [];
    list.push(item);
    retailerGroups.set(item.retailer, list);
  }

  const retailerDistribution: ShoppingRetailerDistribution[] = Array.from(retailerGroups.entries())
    .map(([retailer, group]) => {
      const totalApp = group.reduce((a, i) => a + i.appearances, 0);
      const ownApp = group.filter((i) => i.isOwn).reduce((a, i) => a + i.appearances, 0);
      const compApp = totalApp - ownApp;
      const priced = group.filter((i) => i.price > 0);
      const avgPrice =
        priced.length > 0 ? +(priced.reduce((a, i) => a + i.price, 0) / priced.length).toFixed(2) : 0;

      return {
        retailer,
        totalAppearances: totalApp,
        ownAppearances: ownApp,
        competitorAppearances: compApp,
        sharePct: totalAppearances > 0 ? +((totalApp / totalAppearances) * 100).toFixed(1) : 0,
        ownShareWithinRetailerPct: totalApp > 0 ? +((ownApp / totalApp) * 100).toFixed(1) : 0,
        productCount: group.length,
        avgPrice,
      };
    })
    .sort((a, b) => b.totalAppearances - a.totalAppearances);

  // Apply user filters to product leaderboard
  const filteredProducts = allItems.filter((item) => {
    if (filters?.ownership === "own" && !item.isOwn) return false;
    if (filters?.ownership === "competitor" && item.isOwn) return false;
    if (filters?.retailer && filters.retailer !== "all" && item.retailer !== filters.retailer) return false;
    if (filters?.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      const hay = `${item.title} ${item.brand} ${item.retailer}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    stats: {
      totalAppearances,
      ownAppearances,
      competitorAppearances,
      ownSharePct,
      ownAvgPosition,
      competitorAvgPosition,
      overallAvgPosition,
      ownAvgPrice,
      competitorAvgPrice,
      marketAvgPrice,
      priceDeltaPct,
      retailerCoverageCount: allRetailers.length,
      ownRetailerCount: ownRetailers.size,
      totalProducts: allItems.length,
      ownProductCount: ownRows.length,
      competitorProductCount: compRows.length,
    },
    products: filteredProducts,
    brandComparison,
    retailerDistribution,
    retailers: allRetailers,
  };
}

const createShoppingProductSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  title: z.string().trim().min(2, "Product title is required").max(200),
  retailer: z.string().trim().min(2, "Retailer is required").max(120),
  price: z.number().min(0, "Price must be non-negative").max(100_000),
  // unknown until answers show the product: no invented reach or rank
  appearances: z.number().int().min(0).max(10_000_000).default(0),
  avgPosition: z.number().min(0).max(50, "Position must be <= 50.0").default(0),
  isOwn: z.boolean().default(true),
});

export async function createShoppingProduct(
  db: Db,
  rawInput: z.input<typeof createShoppingProductSchema>,
): Promise<{ id: string; title: string; appearances: number }> {
  const parsed = createShoppingProductSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid shopping product input");
  }
  const input = parsed.data;
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");

    const existing = await tx
      .select()
      .from(shoppingProducts)
      .where(eq(shoppingProducts.websiteId, site.id));

    const dup = existing.find(
      (r) =>
        baseTitleKey(r.title) === baseTitleKey(input.title) &&
        (r.retailer ?? "").trim().toLowerCase() === input.retailer.toLowerCase() &&
        r.isOwn === input.isOwn,
    );
    if (dup) {
      throw new DomainError("A product with this title and retailer already exists in Shopping Insights");
    }

    const [inserted] = await tx
      .insert(shoppingProducts)
      .values({
        websiteId: site.id,
        title: input.title,
        retailer: input.retailer,
        price: input.price.toFixed(2),
        appearances: input.appearances,
        avgPosition: input.avgPosition.toFixed(2),
        isOwn: input.isOwn,
        // seen in answers only once a sync finds it
        lastSeenAt: null,
      })
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      websiteId: site.id,
      userId: input.actorId,
      entityType: "shopping_product",
      entityId: inserted!.id,
      change: "created",
      after: { title: input.title, retailer: input.retailer, isOwn: input.isOwn },
    });

    return { id: inserted!.id, title: inserted!.title, appearances: inserted!.appearances };
  });
}

export async function deleteShoppingProduct(
  db: Db,
  rawInput: { actorId: string; websiteId: string; productId: string },
): Promise<void> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  const [existing] = await db
    .select()
    .from(shoppingProducts)
    .where(and(eq(shoppingProducts.id, rawInput.productId), eq(shoppingProducts.websiteId, site.id)));
  if (!existing) throw new NotFoundError("Shopping product not found");

  await db
    .delete(shoppingProducts)
    .where(and(eq(shoppingProducts.id, existing.id), eq(shoppingProducts.websiteId, site.id)));

  await logActivity(db, {
    organizationId: site.organizationId,
    websiteId: site.id,
    userId: rawInput.actorId,
    entityType: "shopping_product",
    entityId: existing.id,
    change: "deleted",
    before: { title: existing.title },
  });
}

