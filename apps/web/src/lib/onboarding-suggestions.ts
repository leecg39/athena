import "server-only";
import { eq } from "drizzle-orm";
import { db, websites, type WebsiteProfile, type SuggestionCache } from "@athena/db";
import { suggestCompetitors, suggestPrompts, suggestPersonas, type BrandProfileInput } from "@athena/llm/assist";
import { templatePrompts } from "@athena/core/onboarding";
import type { WebsiteRow } from "@athena/core/tenancy";

export type SuggestionSource = "ai" | "template" | "unavailable" | "failed";

export interface Suggestions<T> {
  source: SuggestionSource;
  provider?: string;
  data: T;
}

type CacheKey = keyof NonNullable<WebsiteProfile["suggestions"]>;

function profileInput(site: WebsiteRow): BrandProfileInput {
  const p = site.profile ?? {};
  return { name: site.name, domain: site.domain, description: p.description, headlines: p.headlines, productHints: p.productHints, country: site.country };
}

async function cacheSuggestion<K extends CacheKey>(site: WebsiteRow, key: K, value: NonNullable<WebsiteProfile["suggestions"]>[K]) {
  const profile: WebsiteProfile = { ...(site.profile ?? {}), suggestions: { ...(site.profile?.suggestions ?? {}), [key]: value } };
  await db.update(websites).set({ profile }).where(eq(websites.id, site.id));
}

function cached<T>(c: SuggestionCache<T> | undefined): Suggestions<T> | null {
  return c ? { source: "ai", provider: c.provider, data: c.data } : null;
}

export async function competitorSuggestions(site: WebsiteRow): Promise<Suggestions<{ name: string; domain: string }[]>> {
  const hit = cached(site.profile?.suggestions?.competitors);
  if (hit) return hit;
  const r = await suggestCompetitors(profileInput(site));
  if (!r.ok) return { source: r.reason, data: [] };
  await cacheSuggestion(site, "competitors", { provider: r.provider, generatedAt: new Date().toISOString(), data: r.data });
  return { source: "ai", provider: r.provider, data: r.data };
}

export async function promptSuggestions(
  site: WebsiteRow,
  comps: { name: string; domain: string }[],
): Promise<Suggestions<{ name: string; prompts: string[] }[]>> {
  const hit = cached(site.profile?.suggestions?.prompts);
  if (hit) return hit;
  const r = await suggestPrompts(profileInput(site), comps);
  if (r.ok) {
    await cacheSuggestion(site, "prompts", { provider: r.provider, generatedAt: new Date().toISOString(), data: r.data });
    return { source: "ai", provider: r.provider, data: r.data };
  }
  // deterministic templates from the brand's own copy — clearly labelled in the UI
  return { source: "template", data: templatePrompts({ ...profileInput(site), products: site.profile?.products }, comps) };
}

export async function personaSuggestions(site: WebsiteRow): Promise<Suggestions<{ name: string; description: string }[]>> {
  const hit = cached(site.profile?.suggestions?.personas);
  if (hit) return hit;
  const r = await suggestPersonas(profileInput(site));
  if (!r.ok) return { source: r.reason, data: [] };
  await cacheSuggestion(site, "personas", { provider: r.provider, generatedAt: new Date().toISOString(), data: r.data });
  return { source: "ai", provider: r.provider, data: r.data };
}
