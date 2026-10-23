/**
 * Sponsored placements: those explicitly labelled in collected answers plus
 * the ones your team records. Nothing is invented; viewing never writes.
 */
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { type Db, adsImpressions, competitors, prompts, responses, topics, websites } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { AD_SURFACES, AD_SURFACE_LABELS, type AdImpressionItem, type AdSurface, type AdsSummary, type AdvertiserBreakdownItem } from "./shared";

function normAdKey(surface: string, advertiser: string, adText: string): string {
  return `${surface.toLowerCase()}::${advertiser.trim().toLowerCase()}::${adText.trim().toLowerCase()}`;
}

/**
 * Scans/captures sponsored ads across ChatGPT, Google AI Mode, and Google AI Overview
 * for the website's tracked prompts.
 */
const DAY = 86_400_000;
/** answers scanned per capture run */
const MAX_ANSWERS = 5_000;
const SPONSORED_LINE = /^[ \t]*(?:\[\s*sponsored\s*\]|sponsored\b|promoted\b|ad\b(?=[ \t]*[·•:|]))[ \t]*[·•:|\-–—]?[ \t]*(.{4,300})$/gim;
const DOMAIN = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;

/** Placements an answer explicitly labels as sponsored/promoted (one per labelled line). */
export function detectSponsoredAds(text: string): { advertiser: string; adText: string }[] {
  return [...text.matchAll(SPONSORED_LINE)].map((m) => {
    const adText = m[1].trim();
    const advertiser = DOMAIN.exec(adText)?.[1]?.toLowerCase() ?? adText.split(/\s+[—–-]\s+|:\s/)[0].trim().slice(0, 60);
    return { advertiser, adText };
  });
}

const isSurface = (model: string): model is AdSurface => (AD_SURFACES as readonly string[]).includes(model);

/**
 * Records sponsored placements found in collected answers (a website the
 * caller has ALREADY authorised; users go through captureSponsoredAds). AI
 * provider APIs rarely return ads, so most placements are recorded manually.
 */
export async function captureSponsoredAdsForSite(db: Db, site: WebsiteRow, opts: { days?: number; actorId?: string } = {}): Promise<{ captured: number; total: number }> {
  const since = new Date(Date.now() - Math.min(90, Math.max(7, opts.days ?? 30)) * DAY);
  const rows = await db
    .select({ promptId: responses.promptId, model: responses.model, ranAt: responses.ranAt, text: sql<string>`left(${responses.rawText}, 20000)` })
    .from(responses)
    .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, since), inArray(responses.model, [...AD_SURFACES]), sql`(${responses.rawText} ilike '%sponsored%' or ${responses.rawText} ilike '%promoted%' or ${responses.rawText} ~* '(^|\\n)\\s*ad\\s*[·•:|]')`))
    .limit(MAX_ANSWERS);
  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx.select({ surface: adsImpressions.surface, advertiser: adsImpressions.advertiser, adText: adsImpressions.adText }).from(adsImpressions).where(eq(adsImpressions.websiteId, site.id));
    const known = new Set(existing.map((e) => normAdKey(e.surface, e.advertiser, e.adText ?? "")));
    let captured = 0;
    for (const row of rows) {
      if (!isSurface(row.model)) continue;
      for (const ad of detectSponsoredAds(row.text)) {
        const key = normAdKey(row.model, ad.advertiser, ad.adText);
        if (known.has(key)) continue;
        known.add(key);
        await tx.insert(adsImpressions).values({ websiteId: site.id, promptId: row.promptId, surface: row.model, advertiser: ad.advertiser, adText: ad.adText, seenAt: row.ranAt });
        captured++;
      }
    }
    if (opts.actorId && captured) {
      await logActivity(tx, { organizationId: site.organizationId, websiteId: site.id, userId: opts.actorId, entityType: "ads_impression", entityId: site.id, change: "captured", after: { captured } });
    }
    return { captured, total: existing.length + captured };
  });
}

export async function captureSponsoredAds(db: Db, input: { actorId: string; websiteId: string; days?: number }): Promise<{ captured: number; total: number }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  return captureSponsoredAdsForSite(db, site, { days: input.days, actorId: input.actorId });
}

export async function getAdsSummary(
  db: Db,
  input: { actorId: string; websiteId: string; filters?: { surface?: "all" | AdSurface; advertiser?: string; promptId?: string; search?: string } },
): Promise<AdsSummary> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");
  const websiteId = site.id;
  const filters = input.filters;
  const rows = await db
    .select({
      id: adsImpressions.id,
      websiteId: adsImpressions.websiteId,
      promptId: adsImpressions.promptId,
      surface: adsImpressions.surface,
      advertiser: adsImpressions.advertiser,
      adText: adsImpressions.adText,
      seenAt: adsImpressions.seenAt,
      promptText: prompts.text,
      topicName: topics.name,
    })
    .from(adsImpressions)
    .leftJoin(
      prompts,
      and(eq(prompts.id, adsImpressions.promptId), eq(prompts.websiteId, websiteId)),
    )
    .leftJoin(topics, eq(topics.id, prompts.topicId))
    .where(eq(adsImpressions.websiteId, websiteId))
    .orderBy(desc(adsImpressions.seenAt));

  // read-only: placements come from collected answers or manual records
  const websitePrompts = await db
    .select({ id: prompts.id, text: prompts.text })
    .from(prompts)
    .where(and(eq(prompts.websiteId, websiteId), eq(prompts.status, "active"), isNull(prompts.deletedAt)))
    .orderBy(asc(prompts.createdAt))
    .limit(50);

  const surfaceCounts: Record<AdSurface, number> = {
    chatgpt: 0,
    ai_mode: 0,
    ai_overview: 0,
  };

  const allImpressions: AdImpressionItem[] = rows.map((r) => {
    const rawSurface = (r.surface ?? "chatgpt").toLowerCase();
    const surface: AdSurface = (AD_SURFACES as readonly string[]).includes(rawSurface)
      ? (rawSurface as AdSurface)
      : "chatgpt";
    surfaceCounts[surface]++;

    const isOwn =
      r.advertiser.trim().toLowerCase() === site.name.trim().toLowerCase() ||
      r.advertiser.trim().toLowerCase().includes(site.domain.toLowerCase());

    return {
      id: r.id,
      websiteId: r.websiteId,
      promptId: r.promptId,
      promptText: r.promptText ?? null,
      topicName: r.topicName ?? null,
      surface,
      surfaceLabel: AD_SURFACE_LABELS[surface],
      advertiser: r.advertiser,
      isOwn,
      adText: r.adText ?? "",
      seenAt: r.seenAt,
    };
  });

  const totalImpressions = allImpressions.length;
  const ownAdCount = allImpressions.filter((i) => i.isOwn).length;
  const competitorAdCount = totalImpressions - ownAdCount;
  const promptsWithAdsCount = new Set(
    allImpressions.map((i) => i.promptId).filter((id): id is string => Boolean(id)),
  ).size;

  // Advertiser breakdown
  const advMap = new Map<
    string,
    { advertiser: string; isOwn: boolean; impressions: number; surfaces: Set<AdSurface> }
  >();
  for (const item of allImpressions) {
    const key = item.advertiser.trim().toLowerCase();
    const entry = advMap.get(key) ?? {
      advertiser: item.advertiser,
      isOwn: item.isOwn,
      impressions: 0,
      surfaces: new Set<AdSurface>(),
    };
    entry.impressions++;
    entry.surfaces.add(item.surface);
    advMap.set(key, entry);
  }

  const advertiserBreakdown: AdvertiserBreakdownItem[] = Array.from(advMap.values())
    .map((e) => ({
      advertiser: e.advertiser,
      isOwn: e.isOwn,
      impressions: e.impressions,
      sharePct: totalImpressions > 0 ? +((e.impressions / totalImpressions) * 100).toFixed(1) : 0,
      surfaces: Array.from(e.surfaces),
    }))
    .sort((a, b) => b.impressions - a.impressions);

  const distinctAdvertisers = advertiserBreakdown.map((a) => a.advertiser);

  const filteredImpressions = allImpressions.filter((item) => {
    if (filters?.surface && filters.surface !== "all" && item.surface !== filters.surface) {
      return false;
    }
    if (
      filters?.advertiser &&
      filters.advertiser !== "all" &&
      item.advertiser.toLowerCase() !== filters.advertiser.toLowerCase()
    ) {
      return false;
    }
    if (filters?.promptId && filters.promptId !== "all" && item.promptId !== filters.promptId) {
      return false;
    }
    if (filters?.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      const hay = `${item.advertiser} ${item.adText} ${item.promptText ?? ""} ${item.surfaceLabel}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    stats: {
      totalImpressions,
      surfaceCounts,
      uniqueAdvertisers: advertiserBreakdown.length,
      ownAdCount,
      competitorAdCount,
      promptsWithAdsCount,
    },
    advertiserBreakdown,
    impressions: filteredImpressions,
    advertisers: distinctAdvertisers,
    prompts: websitePrompts,
  };
}

const recordAdImpressionSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  promptId: z.string().uuid().nullable().optional(),
  surface: z.enum(AD_SURFACES),
  advertiser: z.string().trim().min(2, "Advertiser name is required").max(120),
  adText: z.string().trim().min(4, "Sponsored ad copy is required").max(600),
});

export async function recordAdImpression(
  db: Db,
  rawInput: z.input<typeof recordAdImpressionSchema>,
): Promise<{ id: string }> {
  const parsed = recordAdImpressionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid ad impression input");
  }
  const input = parsed.data;
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  // Enforce tenant isolation on promptId if supplied
  let validPromptId: string | null = null;
  if (input.promptId) {
    const [promptRow] = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(and(eq(prompts.id, input.promptId), eq(prompts.websiteId, site.id)));
    if (!promptRow) {
      throw new NotFoundError("Prompt not found in this workspace");
    }
    validPromptId = promptRow.id;
  }

  const [inserted] = await db
    .insert(adsImpressions)
    .values({
      websiteId: site.id,
      promptId: validPromptId,
      surface: input.surface,
      advertiser: input.advertiser,
      adText: input.adText,
      seenAt: new Date(),
    })
    .returning();

  await logActivity(db, {
    organizationId: site.organizationId,
    websiteId: site.id,
    userId: input.actorId,
    entityType: "ads_impression",
    entityId: inserted!.id,
    change: "created",
    after: { surface: input.surface, advertiser: input.advertiser },
  });

  return { id: inserted!.id };
}

export async function deleteAdImpression(
  db: Db,
  rawInput: { actorId: string; websiteId: string; impressionId: string },
): Promise<void> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  const [existing] = await db
    .select()
    .from(adsImpressions)
    .where(and(eq(adsImpressions.id, rawInput.impressionId), eq(adsImpressions.websiteId, site.id)));
  if (!existing) throw new NotFoundError("Ad impression not found");

  await db
    .delete(adsImpressions)
    .where(and(eq(adsImpressions.id, existing.id), eq(adsImpressions.websiteId, site.id)));

  await logActivity(db, {
    organizationId: site.organizationId,
    websiteId: site.id,
    userId: rawInput.actorId,
    entityType: "ads_impression",
    entityId: existing.id,
    change: "deleted",
    before: { surface: existing.surface, advertiser: existing.advertiser },
  });
}
