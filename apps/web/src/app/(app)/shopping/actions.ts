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
      message: `Synced from product cards in collected AI answers: ${res.created} new, ${res.updated} refreshed.`,
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
    const retailer = String(formData.get("retailer") ?? "").trim();
    const price = Number(String(formData.get("price") ?? "").trim() || Number.NaN);
    const isOwn = String(formData.get("isOwn") ?? "true") !== "false";
    if (!Number.isFinite(price)) return { ok: false, error: "Enter the product's price." };

    // appearances and position start unknown; a sync fills them from collected answers
    const created = await createShoppingProduct(db, { actorId: s.user.id, websiteId: s.websiteId, title, retailer, price, isOwn });

    revalidatePath("/shopping");
    return {
      ok: true,
      message: `Added "${created.title}" (${retailer}). Appearances update when collected answers show it.`,
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
