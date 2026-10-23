/**
 * Shopify catalog optimization on real store data: products come from the
 * Shopify Admin API, scores are explainable rules on the actual title and
 * description, recommendations are written by the caller (an AI writer) and
 * "published" means Shopify accepted the product update.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Db, shoppingProducts, contentItems, contentDrafts, contentVersions, publishTargets, websites, kbFacts } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { decodeEntities } from "../shared/html";
import { normKey } from "./shared";
import { markdownToHtml } from "./html";
import { openTargetConfig } from "./cms-targets";
import type { CmsRequest } from "./cms";

const API = "2025-01";

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}

export interface CatalogProductItem {
  id: string;
  websiteId: string;
  title: string;
  retailer: string;
  price: string;
  currentDescription: string;
  appearances: number;
  avgPosition: number;
  titleScore: number;
  descScore: number;
  faqStatus: "ok" | "missing";
  optimizationStatus: "needs_optimization" | "draft_ready" | "published";
  recommendedTitle: string | null;
  recommendedDescription: string | null;
  recommendedFaq: string | null;
  version: number;
}

export interface CatalogSummary {
  products: CatalogProductItem[];
  shopifyConnected: boolean;
  storeDomain: string;
  stats: { totalProducts: number; avgTitleScore: number; avgDescScore: number; faqCoveragePct: number; optimizedCount: number };
}

/**
 * Rule-based listing quality (0-100 each): title — 30-70 characters, names the
 * brand, carries a concrete attribute (number or variant), not shouting;
 * description — length up to 600 characters, a list, numbers, use cases;
 * FAQ present when at least two questions appear.
 */
export function catalogScores(title: string, description: string, brand: string): { titleScore: number; descScore: number; faqStatus: "ok" | "missing" } {
  const t = title.trim();
  const notShouting = (!/[a-z]/i.test(t) || t !== t.toUpperCase()) && !/[!?]{2,}/.test(t);
  const titleScore = (t.length >= 30 && t.length <= 70 ? 40 : t.length >= 15 ? 20 : 0) + (brand && t.toLowerCase().includes(brand.toLowerCase()) ? 20 : 0) + (/\d|[—–]/.test(t) ? 20 : 0) + (notShouting ? 20 : 0);
  const d = description.trim();
  const descScore = Math.round((Math.min(d.length, 600) / 600) * 40) + (/^\s*[-*•]\s|<li>/m.test(d) ? 20 : 0) + (/\d/.test(d) ? 20 : 0) + (/\b(for|ideal|use|works with|compatible)\b/i.test(d) ? 20 : 0);
  const questions = d.split(/\r?\n/).filter((l) => /^\s*Q:|\?\s*$/i.test(l)).length;
  return { titleScore, descScore, faqStatus: questions >= 2 ? "ok" : "missing" };
}

const productSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  title: z.string(),
  body_html: z.string().nullable().optional(),
  handle: z.string().optional(),
  variants: z.array(z.object({ price: z.union([z.string(), z.number()]).nullable().optional() })).optional(),
});

async function shopifyConfig(db: Db, site: WebsiteRow, secretKey: string): Promise<Record<string, string>> {
  const [target] = await db.select().from(publishTargets).where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, "shopify")));
  const cfg = target ? openTargetConfig(target, secretKey) : {};
  if (!cfg.storeDomain || !cfg.accessToken) throw new DomainError("Connect Shopify (store domain and Admin API token) in CMS connections first");
  return cfg;
}

async function shopifyCall(request: CmsRequest, cfg: Record<string, string>, method: "GET" | "PUT", path: string, body?: unknown) {
  let res: { status: number; body: string };
  try {
    res = await request(`https://${cfg.storeDomain}/admin/api/${API}${path}`, { method, headers: { "x-shopify-access-token": cfg.accessToken, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new DomainError("Could not reach Shopify. Check the store domain.");
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = json.errors ? `: ${JSON.stringify(json.errors).slice(0, 200)}` : "";
    throw new DomainError(`Shopify rejected the ${method === "GET" ? "request" : "update"} (HTTP ${res.status})${detail}`);
  }
  return json;
}

const catalogRows = (db: Db, siteId: string) =>
  db.select().from(contentItems).where(and(eq(contentItems.websiteId, siteId), isNull(contentItems.deletedAt), sql`${contentItems.columns}->>'shopifyProductId' is not null`));

export async function syncShopifyCatalog(db: Db, input: { actorId: string; websiteId: string; secretKey: string; request: CmsRequest }): Promise<{ created: number; updated: number; total: number }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const cfg = await shopifyConfig(db, site, input.secretKey);
  const json = await shopifyCall(input.request, cfg, "GET", "/products.json?limit=250");
  const rawProducts = Array.isArray(json.products) ? json.products : [];
  const products = rawProducts.flatMap((p) => {
    const r = productSchema.safeParse(p);
    return r.success ? [r.data] : [];
  });
  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await catalogRows(tx, site.id);
    const byRemote = new Map(existing.map((r) => [String((r.columns ?? {}).shopifyProductId), r]));
    let created = 0;
    let updated = 0;
    for (const p of products) {
      const facts = { shopifyProductId: p.id, handle: p.handle ?? "", price: String(p.variants?.[0]?.price ?? ""), currentDescription: htmlToText(p.body_html ?? "") };
      const match = byRemote.get(p.id);
      if (match) {
        await tx.update(contentItems).set({ title: p.title, columns: { ...(match.columns ?? {}), ...facts } }).where(eq(contentItems.id, match.id));
        updated++;
      } else {
        await tx.insert(contentItems).values({ websiteId: site.id, title: p.title, status: "idea", columns: { catalogProduct: true, agentStage: "idle", ...facts } });
        created++;
      }
    }
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "shopify_catalog", entityId: site.id, change: "synced", after: { created, updated } });
    return { created, updated, total: existing.length + created };
  });
}

export async function listCatalogProducts(db: Db, input: { actorId: string; websiteId: string }): Promise<CatalogSummary> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const [items, seen, [target]] = await Promise.all([
    catalogRows(db, site.id),
    db.select().from(shoppingProducts).where(eq(shoppingProducts.websiteId, site.id)),
    db.select().from(publishTargets).where(and(eq(publishTargets.websiteId, site.id), eq(publishTargets.provider, "shopify"))),
  ]);
  const versions = items.length ? await db.select().from(contentVersions).where(inArray(contentVersions.contentId, items.map((i) => i.id))).orderBy(desc(contentVersions.version)) : [];
  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions) if (!latest.has(v.contentId)) latest.set(v.contentId, v);
  const seenByTitle = new Map(seen.map((s) => [normKey(s.title), s]));
  const products = items.map((item): CatalogProductItem => {
    const cols = item.columns ?? {};
    const ver = latest.get(item.id);
    const ai = seenByTitle.get(normKey(item.title));
    const currentDescription = String(cols.currentDescription ?? "");
    const status: CatalogProductItem["optimizationStatus"] = ver && Number(cols.appliedVersion) === ver.version ? "published" : ver ? "draft_ready" : "needs_optimization";
    return {
      id: item.id,
      websiteId: item.websiteId,
      title: item.title,
      retailer: "Shopify",
      price: cols.price ? String(cols.price) : "—",
      currentDescription,
      appearances: ai?.appearances ?? 0,
      avgPosition: Number(ai?.avgPosition ?? 0),
      ...catalogScores(item.title, currentDescription, site.name),
      optimizationStatus: status,
      recommendedTitle: typeof cols.recommendedTitle === "string" ? cols.recommendedTitle : null,
      recommendedDescription: ver?.body ?? null,
      recommendedFaq: typeof cols.faqBody === "string" ? cols.faqBody : null,
      version: ver?.version ?? 0,
    };
  });
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  return {
    products,
    shopifyConnected: Boolean(target?.config?.storeDomain && target?.config?.accessToken),
    storeDomain: target?.config?.storeDomain ?? "",
    stats: {
      totalProducts: products.length,
      avgTitleScore: avg(products.map((p) => p.titleScore)),
      avgDescScore: avg(products.map((p) => p.descScore)),
      faqCoveragePct: products.length ? Math.round((products.filter((p) => p.faqStatus === "ok").length / products.length) * 100) : 0,
      optimizedCount: products.filter((p) => p.optimizationStatus !== "needs_optimization").length,
    },
  };
}

async function lockedCatalogItem(tx: Db, siteId: string, productId: string) {
  if (!z.string().uuid().safeParse(productId).success) throw new DomainError("Invalid catalog product ID");
  const [item] = await tx.select().from(contentItems).where(and(eq(contentItems.id, productId), eq(contentItems.websiteId, siteId), isNull(contentItems.deletedAt))).for("update");
  if (!item || !(item.columns ?? {}).shopifyProductId) throw new NotFoundError("Catalog product not found");
  return item;
}

/** What an AI writer may use to improve one listing (no write). */
export async function catalogWritingContext(db: Db, input: { actorId: string; websiteId: string; productId: string }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const item = await lockedCatalogItem(db, site.id, input.productId);
  const facts = await db.select({ claim: kbFacts.claim }).from(kbFacts).where(and(eq(kbFacts.websiteId, site.id), eq(kbFacts.status, "confirmed"), isNull(kbFacts.deletedAt))).orderBy(kbFacts.createdAt).limit(8);
  const cols = item.columns ?? {};
  return { brand: site.name, title: item.title, description: String(cols.currentDescription ?? ""), price: String(cols.price ?? ""), facts: facts.map((f) => f.claim) };
}

const draftSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(255, "Shopify titles are limited to 255 characters"),
  description: z.string().trim().min(1, "Add a description").max(20_000),
  faq: z.string().trim().max(5_000).default(""),
});

export async function saveCatalogDraft(db: Db, input: { actorId: string; websiteId: string; productId: string; title: string; description: string; faq?: string; source?: string }) {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid product copy");
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  return db.transaction(async (tx) => {
    const item = await lockedCatalogItem(tx, site.id, input.productId);
    const cols = item.columns ?? {};
    const [latest] = await tx.select().from(contentVersions).where(eq(contentVersions.contentId, item.id)).orderBy(desc(contentVersions.version)).limit(1);
    if (latest && latest.body === parsed.data.description && cols.recommendedTitle === parsed.data.title && String(cols.faqBody ?? "") === parsed.data.faq) {
      return { productId: item.id, version: latest.version };
    }
    const [draft] = await tx.insert(contentDrafts).values({ contentId: item.id, body: parsed.data.description }).returning();
    const [version] = await tx.insert(contentVersions).values({ contentId: item.id, draftId: draft.id, body: parsed.data.description, version: (latest?.version ?? 0) + 1 }).returning();
    await tx.update(contentItems).set({ status: "review", columns: { ...cols, recommendedTitle: parsed.data.title, faqBody: parsed.data.faq, agentStage: "draft_ready" } }).where(eq(contentItems.id, item.id));
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "shopify_catalog", entityId: item.id, change: "generated_product_draft", after: { version: version.version, source: input.source ?? "manual" } });
    return { productId: item.id, version: version.version };
  });
}

/** Sends the latest recommendation to Shopify; the listing changes only if Shopify accepts it. */
export async function applyCatalogOptimizationToShopify(db: Db, input: { actorId: string; websiteId: string; productId: string; secretKey: string; request: CmsRequest }) {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const cfg = await shopifyConfig(db, site, input.secretKey);
  const item = await lockedCatalogItem(db, site.id, input.productId);
  const [ver] = await db.select().from(contentVersions).where(eq(contentVersions.contentId, item.id)).orderBy(desc(contentVersions.version)).limit(1);
  const cols = item.columns ?? {};
  if (!ver || typeof cols.recommendedTitle !== "string") throw new DomainError("Generate or write recommended copy first");
  const faq = String(cols.faqBody ?? "").trim();
  const faqMd = faq.split(/\r?\n/).filter((l) => l.trim()).join("\n\n");
  const html = [markdownToHtml(ver.body), faqMd ? `<h2>FAQ</h2>\n${markdownToHtml(faqMd)}` : ""].filter(Boolean).join("\n");
  await shopifyCall(input.request, cfg, "PUT", `/products/${cols.shopifyProductId}.json`, { product: { id: Number(cols.shopifyProductId), title: cols.recommendedTitle, body_html: html } });
  return db.transaction(async (tx) => {
    const columns = { ...cols, currentDescription: htmlToText(html), appliedVersion: ver.version, appliedAt: new Date().toISOString(), agentStage: "published" };
    const [updated] = await tx.update(contentItems).set({ title: cols.recommendedTitle as string, status: "published", columns }).where(eq(contentItems.id, item.id)).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "shopify_catalog", entityId: item.id, change: "applied_to_shopify", after: { version: ver.version, shopifyProductId: cols.shopifyProductId } });
    return { productId: updated.id, version: ver.version };
  });
}
