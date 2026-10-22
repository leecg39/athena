"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  syncShoppingInsights,
  createShoppingProduct,
  deleteShoppingProduct,
} from "@athena/core/commerce";
import { getSettingsContext } from "@/lib/settings-context";
import { commerceLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = commerceLimiter(userId);
  if (!r.ok) {
    return { ok: false, error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.` };
  }
  return null;
}

export async function syncShoppingInsightsAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const res = await syncShoppingInsights(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
    });

    revalidatePath("/shopping");
    return {
      ok: true,
      message: `Shopping carousel synced (${res.created} added, ${res.updated} refreshed across AI shopping surfaces).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to sync shopping carousel insights.");
  }
}

export async function createShoppingProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const title = String(formData.get("title") ?? "").trim();
    const retailer = String(formData.get("retailer") ?? "").trim() || "Shopify";
    const price = Number(formData.get("price") ?? 19);
    const appearances = Number(formData.get("appearances") ?? 180) || 180;
    const avgPosition = Number(formData.get("avgPosition") ?? 1.8) || 1.8;
    const isOwn = String(formData.get("isOwn") ?? "true") !== "false";

    const created = await createShoppingProduct(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      title,
      retailer,
      price,
      appearances,
      avgPosition,
      isOwn,
    });

    revalidatePath("/shopping");
    return {
      ok: true,
      message: `Added "${created.title}" (${retailer}) to AI Shopping Carousel tracker.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to add shopping product.");
  }
}

export async function deleteShoppingProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const productId = String(formData.get("productId") ?? "").trim();
    await deleteShoppingProduct(db, {
      actorId: s.user.id,
      websiteId: s.websiteId,
      productId,
    });

    revalidatePath("/shopping");
    return {
      ok: true,
      message: "Removed product from Shopping Insights.",
    };
  } catch (err) {
    return toActionError(err, "Failed to remove shopping product.");
  }
}
