"use server";

import { redirect } from "next/navigation";
import { db } from "@athena/db";
import { crawlSite, BlockedUrlError } from "@athena/crawler";
import { createWebsite, getPrimaryOrganizationId, requireWebsitePermission } from "@athena/core/tenancy";
import {
  saveBrandProfile,
  addCompetitors,
  addTrackedPrompts,
  saveAudience,
  saveMonitoringSchedule,
  completeOnboarding,
  CADENCES,
  type Cadence,
} from "@athena/core/onboarding";
import { eq } from "drizzle-orm";
import { websites } from "@athena/db";
import { requireUser } from "@/lib/session";
import { setActiveWebsite } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";
import { stepHref, nextStep, type StepId } from "./_steps/frame";
import { parseCompetitorLines, parsePersonaLines, parseLines } from "./_steps/parse";
import { crawlLimiter } from "@/lib/limits";
import { scheduleReanalysis } from "@/lib/collection";

function goNext(websiteId: string, step: StepId): never {
  const next = nextStep(step);
  redirect(next ? stepHref(websiteId, next) : "/prompts");
}

/** Step 1: crawl the site (SSRF-safe), create the website with the crawled profile. */
export async function startOnboarding(_: ActionState, fd: FormData): Promise<ActionState> {
  let websiteId = "";
  const result = await runAction(async () => {
    const user = await requireUser("/onboarding");
    const orgId = await getPrimaryOrganizationId(db, user.id);
    if (!orgId) return { ok: false, error: "No organization found for your account" };
    const input = str(fd, "domain").trim();
    if (!input) return { ok: false, error: "Enter your website domain" };
    if (!crawlLimiter(user.id).ok) return { ok: false, error: "Too many websites analyzed recently. Please wait a few minutes." };
    let crawl: Awaited<ReturnType<typeof crawlSite>> | null = null;
    try {
      crawl = await crawlSite(input);
    } catch (err) {
      if (err instanceof BlockedUrlError) return { ok: false, error: "That address cannot be crawled. Use your public website domain." };
      crawl = null; // unreachable sites can still be tracked
    }
    const domain = crawl?.suggestion.domain ?? input;
    const site = await createWebsite(db, { organizationId: orgId, userId: user.id, domain, name: crawl?.suggestion.name ?? domain });
    if (crawl) {
      await db
        .update(websites)
        .set({
          profile: {
            description: crawl.suggestion.description,
            headlines: crawl.suggestion.headlines,
            productHints: crawl.suggestion.productHints,
            language: crawl.suggestion.language,
            crawledAt: new Date().toISOString(),
            aiAccess: crawl.aiAccess.map((a) => ({ bot: a.bot, owner: a.owner, status: a.status, detail: a.detail })),
            sitemapUrlCount: crawl.sitemapUrls.length,
          },
        })
        .where(eq(websites.id, site.id));
    }
    await setActiveWebsite(user.id, site.id);
    websiteId = site.id;
    return { ok: true };
  });
  if (result.ok && websiteId) redirect(stepHref(websiteId, "brand"));
  return result;
}

async function actor(websiteId: string) {
  const user = await requireUser(`/onboarding/${websiteId}/brand`);
  return user.id;
}

export async function saveBrandStep(_: ActionState, fd: FormData): Promise<ActionState> {
  const websiteId = str(fd, "websiteId");
  const r = await runAction(async () => {
    await saveBrandProfile(db, {
      actorId: await actor(websiteId),
      websiteId,
      name: str(fd, "name"),
      description: str(fd, "description"),
      products: str(fd, "products").split(","),
    });
  });
  if (r.ok) goNext(websiteId, "brand");
  return r;
}

export async function saveCompetitorStep(_: ActionState, fd: FormData): Promise<ActionState> {
  const websiteId = str(fd, "websiteId");
  const r = await runAction(async () => {
    const picked = fd.getAll("suggested").map(String).map((v) => {
      const [name, domain] = v.split("|");
      return { name, domain };
    });
    const added = await addCompetitors(db, { actorId: await actor(websiteId), websiteId, competitors: [...picked, ...parseCompetitorLines(str(fd, "manual"))] });
    // the step can be revisited after answers were collected
    if (added.length) await scheduleReanalysis(websiteId);
  });
  if (r.ok) goNext(websiteId, "competitors");
  return r;
}

export async function savePromptStep(_: ActionState, fd: FormData): Promise<ActionState> {
  const websiteId = str(fd, "websiteId");
  const r = await runAction(async () => {
    const byTopic = new Map<string, string[]>();
    for (const v of fd.getAll("suggested").map(String)) {
      const sep = v.indexOf("::");
      if (sep === -1) continue;
      const topic = v.slice(0, sep);
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), v.slice(sep + 2)]);
    }
    const manualTopic = str(fd, "manualTopic").trim() || "My prompts";
    const manual = parseLines(str(fd, "manual"));
    if (manual.length) byTopic.set(manualTopic, [...(byTopic.get(manualTopic) ?? []), ...manual]);
    if (!byTopic.size) return { ok: false, error: "Select or enter at least one prompt to track" };
    const res = await addTrackedPrompts(db, {
      actorId: await actor(websiteId),
      websiteId,
      topics: [...byTopic].map(([name, prompts]) => ({ name, prompts })),
    });
    return { ok: true, message: `${res.created} prompts added` };
  });
  if (r.ok) goNext(websiteId, "prompts");
  return r;
}

export async function saveAudienceStep(_: ActionState, fd: FormData): Promise<ActionState> {
  const websiteId = str(fd, "websiteId");
  const r = await runAction(async () => {
    const country = str(fd, "country");
    const locations = parseLines(str(fd, "locations")).map((name) => ({ name, country }));
    const picked = fd.getAll("suggested").map(String).map((v) => {
      const [name, ...rest] = v.split("|");
      return { name, description: rest.join("|") };
    });
    const manual = parsePersonaLines(str(fd, "manual"));
    await saveAudience(db, { actorId: await actor(websiteId), websiteId, country, locations, personas: [...picked, ...manual] });
  });
  if (r.ok) goNext(websiteId, "audience");
  return r;
}

export async function skipStep(fd: FormData): Promise<void> {
  const websiteId = str(fd, "websiteId");
  const step = str(fd, "step") as StepId;
  // only a permission check: skipping persists nothing
  await requireWebsitePermission(db, await actor(websiteId), websiteId, "prompts:write");
  goNext(websiteId, step);
}

export async function finishOnboarding(_: ActionState, fd: FormData): Promise<ActionState> {
  const websiteId = str(fd, "websiteId");
  const r = await runAction(async () => {
    const cadence = str(fd, "cadence");
    if (!(CADENCES as readonly string[]).includes(cadence)) return { ok: false, error: "Choose a monitoring schedule" };
    const actorId = await actor(websiteId);
    await saveMonitoringSchedule(db, { actorId, websiteId, cadence: cadence as Cadence });
    await completeOnboarding(db, { actorId, websiteId });
  });
  if (r.ok) redirect("/prompts?welcome=1");
  return r;
}
