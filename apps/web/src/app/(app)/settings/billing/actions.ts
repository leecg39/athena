"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import { allocateWebsiteCredits, getBillingOverview, isAddonId, isPackId, testBuyPack, testChangePlan, testToggleAddon } from "@athena/core/billing";
import { getSettingsContext } from "@/lib/settings-context";
import { appBaseUrl } from "@/lib/email";
import { billingMode, createCheckoutSession, createPortalSession, type CheckoutItem } from "@/lib/stripe-billing";
import { pitchesLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  unstable_rethrow(err);
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) return { ok: false, error: err.message };
  console.error("[billing] action failed", err);
  return { ok: false, error: fallback };
}

async function context() {
  const s = await getSettingsContext();
  const r = pitchesLimiter(s.user.id);
  if (!r.ok) throw new DomainError(`Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.`);
  if (!s.can("billing:write")) throw new ForbiddenError("Billing access required");
  return s;
}

const OFF = "Billing isn't configured on this server (set the Stripe keys).";

/** Sends the user to Stripe Checkout (or the Customer Portal for an existing subscription). */
async function toStripe(s: Awaited<ReturnType<typeof context>>, item: CheckoutItem | null): Promise<never> {
  const overview = await getBillingOverview(db, { actorId: s.user.id, organizationId: s.organizationId });
  const origin = await appBaseUrl();
  const customerId = overview.subscription.stripeCustomerId;
  const managePlan = !item || (item.kind === "plan" && overview.subscription.stripeSubscriptionId);
  if (managePlan) {
    if (!customerId) throw new DomainError("There is no Stripe subscription to manage yet.");
    redirect(await createPortalSession(customerId, origin));
  }
  redirect(await createCheckoutSession({ organizationId: s.organizationId, customerId, email: s.user.email ?? null, item: item!, origin }));
}

export async function changeSubscriptionPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await context();
    const plan = String(formData.get("plan") ?? "");
    const interval = String(formData.get("billingInterval") ?? "monthly") === "annual" ? "annual" : "monthly";
    const mode = billingMode();
    if (mode === "off") return { ok: false, error: OFF };
    if (mode === "test") {
      const res = await testChangePlan(db, { actorId: s.user.id, organizationId: s.organizationId, plan, billingInterval: interval });
      revalidatePath("/settings/billing");
      return { ok: true, message: `Test mode: switched to ${res.plan} (not charged${res.creditsGranted ? `, +${res.creditsGranted.toLocaleString()} test credits` : ""}).` };
    }
    return toStripe(s, plan === "starter" || plan === "enterprise" ? { kind: "plan", plan, interval } : null);
  } catch (err) {
    return toActionError(err, "Failed to update the subscription.");
  }
}

export async function purchaseCreditPackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await context();
    const packId = String(formData.get("packId") ?? "");
    if (!isPackId(packId)) return { ok: false, error: "Unknown credit pack" };
    const mode = billingMode();
    if (mode === "off") return { ok: false, error: OFF };
    if (mode === "test") {
      const res = await testBuyPack(db, { actorId: s.user.id, organizationId: s.organizationId, packId });
      revalidatePath("/settings/billing");
      return { ok: true, message: `Test mode: added ${res.creditsAdded.toLocaleString()} test credits (not charged).` };
    }
    return toStripe(s, { kind: "pack", packId });
  } catch (err) {
    return toActionError(err, "Failed to start the credit pack checkout.");
  }
}

export async function toggleBillingAddonAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await context();
    const addonId = String(formData.get("addonId") ?? "");
    if (!isAddonId(addonId)) return { ok: false, error: "Unknown add-on" };
    const enabled = String(formData.get("enabled") ?? "true") === "true";
    const mode = billingMode();
    if (mode === "off") return { ok: false, error: OFF };
    if (mode === "test") {
      await testToggleAddon(db, { actorId: s.user.id, organizationId: s.organizationId, addonId, enabled });
      revalidatePath("/settings/billing");
      return { ok: true, message: `Test mode: add-on ${enabled ? "enabled" : "disabled"} (not charged).` };
    }
    // cancelling an add-on happens in the Customer Portal
    return toStripe(s, enabled ? { kind: "addon", addonId } : null);
  } catch (err) {
    return toActionError(err, "Failed to update the add-on.");
  }
}

export async function allocateWebsiteCreditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const s = await context();
    const direction = String(formData.get("direction") ?? "to_website") === "to_org" ? "to_org" : "to_website";
    const amount = Number(formData.get("amount") ?? 0);
    const res = await allocateWebsiteCredits(db, { actorId: s.user.id, organizationId: s.organizationId, websiteId: String(formData.get("websiteId") ?? ""), amount, direction, reason: String(formData.get("reason") ?? "").trim() || undefined });
    revalidatePath("/settings/billing");
    return { ok: true, message: direction === "to_website" ? `Allocated ${amount.toLocaleString()} credits to the website pool (website: ${res.websiteBalance.toLocaleString()} · organization: ${res.orgBalance.toLocaleString()}).` : `Returned ${amount.toLocaleString()} credits to the organization pool (website: ${res.websiteBalance.toLocaleString()} · organization: ${res.orgBalance.toLocaleString()}).` };
  } catch (err) {
    return toActionError(err, "Failed to allocate website credits.");
  }
}
