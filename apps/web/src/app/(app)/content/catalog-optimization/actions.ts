"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  syncShopifyCatalog,
  generateCatalogProductDraft,
  applyCatalogOptimizationToShopify,
} from "@athena/core/content";
import { getSettingsContext } from "@/lib/settings-context";
import { contentLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

export async function syncShopifyCatalogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = contentLimiter(s.user.id);
    if (!limited.ok) {
      return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(limited.retryAfterMs / 1000)}s.` };
    }
    const storeDomain = String(formData.get("storeDomain") ?? "").trim() || undefined;
    const res = await syncShopifyCatalog(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      storeDomain,
    });
    revalidatePath("/content/catalog-optimization");
    revalidatePath("/content");
    revalidatePath("/settings/integrations");
    return {
      ok: true,
      message: `Shopify catalog synced (${res.created} added, ${res.updated} updated).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to sync Shopify catalog.");
  }
}

export async function generateCatalogDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = contentLimiter(s.user.id);
    if (!limited.ok) {
      return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(limited.retryAfterMs / 1000)}s.` };
    }
    const productId = String(formData.get("productId") ?? "").trim();
    const res = await generateCatalogProductDraft(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      productId,
    });
    revalidatePath("/content/catalog-optimization");
    return {
      ok: true,
      message: `Generated AI-recommended product copy & FAQ schema (v${res.version}) for "${res.recommendedTitle}".`,
    };
  } catch (err) {
    return toActionError(err, "Failed to generate product optimization draft.");
  }
}

export async function applyCatalogOptimizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = contentLimiter(s.user.id);
    if (!limited.ok) {
      return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(limited.retryAfterMs / 1000)}s.` };
    }
    const productId = String(formData.get("productId") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim() || undefined;
    const description = String(formData.get("description") ?? "").trim() || undefined;
    const faq = String(formData.get("faq") ?? "").trim() || undefined;

    const res = await applyCatalogOptimizationToShopify(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      productId,
      title,
      description,
      faq,
    });
    revalidatePath("/content/catalog-optimization");
    revalidatePath("/shopping");
    return {
      ok: true,
      message: `Published optimized copy & FAQ schema for "${res.title}" to Shopify catalog.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to publish optimization to Shopify.");
  }
}
