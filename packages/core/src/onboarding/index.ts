/**
 * Onboarding wizard persistence: brand profile → competitors → prompts →
 * audience (country/locations/personas) → monitoring schedule → complete.
 * Every step is idempotent so the wizard can be resumed or re-submitted.
 */
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  type Db,
  websites,
  organizations,
  competitors,
  topics,
  prompts,
  personas,
  locations,
  promptSchedules,
} from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy/index";
import { logActivity } from "../org/activity";
import { DomainError } from "../org/errors";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Maximum live tracked prompts per website, by plan. */
export const PROMPT_LIMITS = { free: 50, starter: 500, enterprise: 5000 } as const;

export const CADENCES = ["daily", "every_3_days", "weekly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const ONBOARDING_STEPS = ["website", "brand", "competitors", "prompts", "audience", "search-console", "schedule"] as const;

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Strict domain normaliser for user/LLM supplied competitor domains. */
export function normalizeCompetitorDomain(input: string): string {
  const raw = input.trim().toLowerCase();
  let host = "";
  try {
    if (!/\s/.test(raw)) host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  if (!DOMAIN_RE.test(host)) throw new DomainError(`Invalid competitor domain: ${input.slice(0, 80)}`);
  return host;
}

async function advanceStep(tx: Tx, websiteId: string, step: number): Promise<void> {
  await tx
    .update(websites)
    .set({ onboardingStep: sql`greatest(${websites.onboardingStep}, ${step})` })
    .where(eq(websites.id, websiteId));
}

/* ---------------- brand profile ---------------- */

const brandInput = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional().nullable(),
  products: z.array(z.string()).max(50).optional(),
});

export async function saveBrandProfile(db: Db, input: z.input<typeof brandInput>): Promise<WebsiteRow> {
  const data = brandInput.parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "websites:write");
  const products = (data.products ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 20);
  return db.transaction(async (tx) => {
    const profile = { ...(site.profile ?? {}), description: data.description || undefined, products };
    const [updated] = await tx
      .update(websites)
      .set({ name: data.name, profile, onboardingStep: sql`greatest(${websites.onboardingStep}, 1)` })
      .where(eq(websites.id, site.id))
      .returning();
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: data.actorId,
      websiteId: site.id,
      entityType: "website",
      entityId: site.id,
      change: "profile_updated",
      before: { name: site.name },
      after: { name: updated.name, description: profile.description, products },
    });
    return updated;
  });
}

/* ---------------- competitors ---------------- */

const competitorInput = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  competitors: z.array(z.object({ name: z.string().trim().min(1).max(80), domain: z.string().max(300) })).max(50),
});

export async function addCompetitors(db: Db, input: z.input<typeof competitorInput>) {
  const data = competitorInput.parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  const wanted = new Map<string, string>();
  for (const c of data.competitors) {
    const domain = normalizeCompetitorDomain(c.domain);
    if (domain === site.domain || wanted.has(domain)) continue;
    wanted.set(domain, c.name);
  }
  return db.transaction(async (tx) => {
    const rows = wanted.size
      ? await tx
          .insert(competitors)
          .values([...wanted].map(([domain, name]) => ({ websiteId: site.id, domain, name })))
          .onConflictDoNothing()
          .returning()
      : [];
    if (rows.length) {
      await logActivity(tx, {
        organizationId: site.organizationId,
        userId: data.actorId,
        websiteId: site.id,
        entityType: "competitor",
        change: "created",
        after: { domains: rows.map((r) => r.domain) },
      });
    }
    await advanceStep(tx, site.id, 2);
    return rows;
  });
}

/* ---------------- prompts ---------------- */

const promptInput = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  topics: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        prompts: z.array(z.string()).max(200),
      }),
    )
    .max(30),
});

const cleanPrompt = (p: string) => p.trim().replace(/\s+/g, " ");

export function isBrandedPrompt(text: string, brandName: string, domain: string): boolean {
  const t = text.toLowerCase();
  const label = domain.split(".")[0] ?? "";
  return t.includes(brandName.toLowerCase()) || (label.length >= 4 && t.includes(label.toLowerCase()));
}

export async function addTrackedPrompts(db: Db, input: z.input<typeof promptInput>): Promise<{ created: number; skipped: number }> {
  const data = promptInput.parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    // serialise prompt writes per website so concurrent saves cannot exceed the plan limit
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [org] = await tx.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, site.organizationId));
    const limit = PROMPT_LIMITS[org?.plan ?? "free"];
    const existing = await tx
      .select({ text: prompts.text })
      .from(prompts)
      .where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
    const seen = new Set(existing.map((p) => p.text.toLowerCase()));
    const [schedule] = await tx
      .select({ id: promptSchedules.id })
      .from(promptSchedules)
      .where(and(eq(promptSchedules.websiteId, site.id), eq(promptSchedules.kind, "default"), isNull(promptSchedules.archivedAt)));

    let skipped = 0;
    const plan: { topic: string; texts: string[] }[] = [];
    for (const t of data.topics) {
      const texts: string[] = [];
      for (const raw of t.prompts) {
        const text = cleanPrompt(raw);
        if (text.length < 5 || text.length > 500 || seen.has(text.toLowerCase())) {
          skipped++;
          continue;
        }
        seen.add(text.toLowerCase());
        texts.push(text);
      }
      if (texts.length) plan.push({ topic: t.name, texts });
    }
    const created = plan.reduce((n, p) => n + p.texts.length, 0);
    if (existing.length + created > limit) {
      throw new DomainError(`Prompt limit reached: your plan allows ${limit} tracked prompts per website`);
    }
    for (const p of plan) {
      const [topic] = await tx
        .insert(topics)
        .values({ websiteId: site.id, name: p.topic })
        .onConflictDoUpdate({ target: [topics.websiteId, topics.name], set: { deletedAt: null } })
        .returning({ id: topics.id });
      await tx.insert(prompts).values(
        p.texts.map((text) => ({
          websiteId: site.id,
          topicId: topic.id,
          text,
          type: isBrandedPrompt(text, site.name, site.domain) ? ("branded" as const) : ("non_branded" as const),
          scheduleId: schedule?.id ?? null,
        })),
      );
    }
    if (created) {
      await logActivity(tx, {
        organizationId: site.organizationId,
        userId: data.actorId,
        websiteId: site.id,
        entityType: "prompt",
        change: "created",
        after: { count: created, topics: plan.map((p) => p.topic) },
      });
    }
    await advanceStep(tx, site.id, 3);
    return { created, skipped };
  });
}

/* ---------------- audience ---------------- */

const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter country code");
const audienceInput = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  country,
  locations: z.array(z.object({ name: z.string().trim().min(1).max(80), country })).max(20),
  personas: z.array(z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(300).optional() })).max(10),
});

export async function saveAudience(db: Db, input: z.input<typeof audienceInput>) {
  const data = audienceInput.parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  await db.transaction(async (tx) => {
    await tx.update(websites).set({ country: data.country }).where(eq(websites.id, site.id));
    if (data.locations.length) {
      await tx
        .insert(locations)
        .values(data.locations.map((l) => ({ websiteId: site.id, name: l.name, country: l.country })))
        .onConflictDoNothing();
    }
    if (data.personas.length) {
      await tx
        .insert(personas)
        .values(data.personas.map((p) => ({ websiteId: site.id, name: p.name, description: p.description || null })))
        .onConflictDoNothing();
    }
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: data.actorId,
      websiteId: site.id,
      entityType: "audience",
      change: "updated",
      after: { country: data.country, locations: data.locations.map((l) => l.name), personas: data.personas.map((p) => p.name) },
    });
    await advanceStep(tx, site.id, 4);
  });
}

/* ---------------- schedule & completion ---------------- */

const scheduleInput = z.object({ actorId: z.string().uuid(), websiteId: z.string().uuid(), cadence: z.enum(CADENCES) });

export async function saveMonitoringSchedule(db: Db, input: z.input<typeof scheduleInput>) {
  const data = scheduleInput.parse(input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "prompts:write");
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(promptSchedules)
      .where(and(eq(promptSchedules.websiteId, site.id), eq(promptSchedules.kind, "default"), isNull(promptSchedules.archivedAt)));
    const [schedule] = existing
      ? await tx.update(promptSchedules).set({ cadence: data.cadence }).where(eq(promptSchedules.id, existing.id)).returning()
      : await tx.insert(promptSchedules).values({ websiteId: site.id, name: "Default", kind: "default", cadence: data.cadence }).returning();
    await tx
      .update(prompts)
      .set({ scheduleId: schedule.id })
      .where(and(eq(prompts.websiteId, site.id), isNull(prompts.scheduleId), isNull(prompts.deletedAt)));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: data.actorId,
      websiteId: site.id,
      entityType: "schedule",
      entityId: schedule.id,
      change: existing ? "updated" : "created",
      before: existing ? { cadence: existing.cadence } : undefined,
      after: { cadence: data.cadence },
    });
    await advanceStep(tx, site.id, 6);
    return schedule;
  });
}

export async function completeOnboarding(db: Db, input: { actorId: string; websiteId: string }): Promise<WebsiteRow> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "websites:write");
  const [w] = await db
    .update(websites)
    .set({ onboardedAt: site.onboardedAt ?? new Date(), onboardingStep: ONBOARDING_STEPS.length })
    .where(eq(websites.id, site.id))
    .returning();
  return w;
}

/* ---------------- deterministic suggestions (no LLM) ---------------- */

export interface TemplateProfile {
  name: string;
  domain: string;
  description?: string;
  /** user-confirmed products/services (preferred over marketing copy) */
  products?: string[];
  headlines?: string[];
  productHints?: string[];
}

/** Category phrase from the brand's own copy, e.g. "Canvasly is an AI design canvas." → "ai design canvas". */
export function categoryPhrase(p: TemplateProfile): string | null {
  const source = p.description || p.headlines?.[0] || "";
  let s = source.split(/[.!?\n]/)[0]?.trim() ?? "";
  const brand = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  s = s.replace(new RegExp(`^${brand}\\s+(is|are)\\s+`, "i"), "");
  s = s.replace(/^(the|an|a)\s+/i, "");
  s = s.replace(/^(world's|worlds|#1|leading|best)\s+/i, "");
  const words = s.split(/\s+/).filter(Boolean).slice(0, 8);
  const phrase = words.join(" ").toLowerCase().replace(/[,;:]+$/, "");
  return phrase.length >= 3 ? phrase : null;
}

export function templatePrompts(p: TemplateProfile, comps: { name: string; domain: string }[]): { name: string; prompts: string[] }[] {
  const out: { name: string; prompts: string[] }[] = [];
  const products = (p.products ?? []).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2).slice(0, 2);
  const category = products.length ? null : categoryPhrase(p);
  if (products.length) {
    out.push({
      name: "Category discovery",
      prompts: products.flatMap((prod) => [`what is the best ${prod}`, `best ${prod} alternatives`, `how to choose ${prod}`]),
    });
  }
  if (category) {
    out.push({
      name: "Category discovery",
      prompts: [`what is the best ${category}`, `best ${category} for small teams`, `how to choose a ${category}`, `${category} recommendations`],
    });
  }
  out.push({ name: `${p.name} brand`, prompts: [`what is ${p.name}`, `is ${p.name} worth it`, `${p.name} pricing`, `${p.name} reviews`] });
  out.push({
    name: "Alternatives & comparisons",
    prompts: [`${p.name} alternatives`, ...comps.slice(0, 3).map((c) => `${p.name} vs ${c.name}`)],
  });
  return out;
}
