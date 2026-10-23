"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  type OptimizationStage,
  runSiteHealthCrawl,
  runStagingReleaseCheck,
  createSiteHealthPage,
  updatePageOptimization,
  verifyLivePageContent,
  deleteSiteHealthPage,
} from "@athena/core/site-health";
import { getSettingsContext } from "@/lib/settings-context";
import { fetchSiteResource } from "@/lib/page-fetch";
import { siteHealthLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = siteHealthLimiter(userId);
  if (!r.ok) {
    return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.` };
  }
  return null;
}

export async function runSiteHealthCrawlAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const res = await runSiteHealthCrawl(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      fetchPage: fetchSiteResource,
    });

    revalidatePath("/site-health");
    return {
      ok: true,
      message: `Site Health crawl completed (${res.created} new pages discovered, ${res.updated} pages audited across 10 AI search crawlers).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to crawl site health.");
  }
}

export async function runStagingReleaseCheckAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const stagingHost = String(formData.get("stagingHost") ?? "").trim() || undefined;
    const res = await runStagingReleaseCheck(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      stagingHost,
      fetchPage: fetchSiteResource,
    });

    revalidatePath("/site-health");
    return {
      ok: true,
      message: `Staging release check against "${res.stagingHost}" completed (${res.checked} pages compared, ${res.regressions} regressions detected).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to run staging release check.");
  }
}

export async function createSiteHealthPageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const url = String(formData.get("url") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const property = String(formData.get("property") ?? "Marketing & Core").trim() || "Marketing & Core";
    const keyword = String(formData.get("keyword") ?? "").trim() || undefined;
    const position = Number(formData.get("position") ?? 4) || 4;

    const created = await createSiteHealthPage(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      url,
      title,
      property,
      keyword,
      position,
    });

    revalidatePath("/site-health");
    return {
      ok: true,
      message: `Added "${created.url}" to Site Health monitoring (${property}).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to add page to Site Health.");
  }
}

export async function updatePageOptimizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const pageId = String(formData.get("pageId") ?? "").trim();
    const rawStage = String(formData.get("optimizationStatus") ?? "staged").trim();
    const validStages: OptimizationStage[] = ["healthy", "needs_edit", "staged", "verified_live"];
    const optimizationStatus: OptimizationStage = validStages.includes(rawStage as OptimizationStage)
      ? (rawStage as OptimizationStage)
      : "staged";
    const recommendation = String(formData.get("recommendation") ?? "").trim() || undefined;

    await updatePageOptimization(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      pageId,
      optimizationStatus,
      recommendation,
    });

    revalidatePath("/site-health");
    return {
      ok: true,
      message: `Moved page optimization status to "${optimizationStatus.replace("_", " ")}".`,
    };
  } catch (err) {
    return toActionError(err, "Failed to update page optimization.");
  }
}

export async function verifyLivePageContentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const pageId = String(formData.get("pageId") ?? "").trim();
    const res = await verifyLivePageContent(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      pageId,
      fetchPage: fetchSiteResource,
    });

    revalidatePath("/site-health");
    return {
      ok: true,
      message: `Live content verified for "${res.url}" (signature ${res.verificationHash}). All 10 AI search crawlers allowed.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to verify live page content.");
  }
}

export async function deleteSiteHealthPageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const pageId = String(formData.get("pageId") ?? "").trim();
    await deleteSiteHealthPage(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      pageId,
    });

    revalidatePath("/site-health");
    return {
      ok: true,
      message: "Removed page from Site Health monitoring.",
    };
  } catch (err) {
    return toActionError(err, "Failed to remove page.");
  }
}
