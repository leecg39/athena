"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod/v4";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  syncShopifyCatalog,
  catalogWritingContext,
  saveCatalogDraft,
  applyCatalogOptimizationToShopify,
} from "@athena/core/content";
import { generateStructured } from "@athena/llm/assist";
import { getSettingsContext } from "@/lib/settings-context";
import { integrationKey } from "@/lib/integrations";
import { cmsRequest } from "@/lib/cms-request";
import { contentLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const limited = contentLimiter(userId);
  if (!limited.ok) {
    return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(limited.retryAfterMs / 1000)}s.` };
  }
  return null;
}

export async function syncShopifyCatalogAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const res = await syncShopifyCatalog(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      secretKey: integrationKey(),
      request: cmsRequest,
    });
    revalidatePath("/content/catalog-optimization");
    revalidatePath("/content");
    return {
      ok: true,
      message: `Synced ${res.total} product(s) from Shopify (${res.created} added, ${res.updated} updated).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to sync Shopify catalog.");
  }
}

const copySchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(10_000),
  faq: z.string().max(4_000),
});

export async function generateCatalogDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const productId = String(formData.get("productId") ?? "").trim();
    const ctx = await catalogWritingContext(db, { actorId: s.user.id, websiteId: s.websiteId, productId });
    const ai = await generateStructured({
      system: [
        "You improve a Shopify product listing so AI shopping assistants can quote it accurately.",
        "Use only facts already present in the current listing or the confirmed facts list; never invent specifications, prices, certifications or warranties.",
        "Return JSON { title, description, faq } where description is Markdown with bullet points and use cases, and faq has 2-3 Q:/A: pairs.",
      ].join(" "),
      prompt: JSON.stringify(ctx),
      schema: copySchema,
      maxTokens: 2500,
    });
    if (!ai.ok) {
      return {
        ok: false,
        error:
          ai.reason === "unavailable"
            ? "An AI provider is needed to draft product copy — edit the copy below directly or configure an API key."
            : "The AI provider failed. Please try again or edit the copy below directly.",
      };
    }
    const res = await saveCatalogDraft(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      productId,
      title: ai.data.title,
      description: ai.data.description,
      faq: ai.data.faq,
      source: ai.provider,
    });
    revalidatePath("/content/catalog-optimization");
    return {
      ok: true,
      message: `${ai.provider} drafted v${res.version} — review the copy before publishing to Shopify.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to generate product optimization draft.");
  }
}

export async function saveCatalogDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const productId = String(formData.get("productId") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const faq = String(formData.get("faq") ?? "").trim();
    const res = await saveCatalogDraft(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      productId,
      title,
      description,
      faq,
      source: "manual",
    });
    revalidatePath("/content/catalog-optimization");
    return { ok: true, message: `Saved draft v${res.version}.` };
  } catch (err) {
    return toActionError(err, "Failed to save product draft.");
  }
}

export async function applyCatalogOptimizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;
    const productId = String(formData.get("productId") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const faq = String(formData.get("faq") ?? "").trim();
    if (title && description) {
      await saveCatalogDraft(db, {
        actorId: s.user.id,
        websiteId: s.websiteId,
        productId,
        title,
        description,
        faq,
        source: "manual",
      });
    }
    const res = await applyCatalogOptimizationToShopify(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      productId,
      secretKey: integrationKey(),
      request: cmsRequest,
    });
    revalidatePath("/content/catalog-optimization");
    revalidatePath("/shopping");
    return { ok: true, message: `Published v${res.version} to Shopify.` };
  } catch (err) {
    return toActionError(err, "Failed to publish optimization to Shopify.");
  }
}
