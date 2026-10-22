"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import { DomainError, ForbiddenError, NotFoundError } from "@athena/core/org";
import {
  BILLING_INTERVALS,
  type BillingAddonId,
  type BillingInterval,
  type CreditPackId,
  allocateWebsiteCredits,
  changeSubscriptionPlan,
  purchaseCreditPack,
  toggleBillingAddon,
} from "@athena/core/billing";
import type { PlanTier } from "@athena/core";
import { getSettingsContext } from "@/lib/settings-context";
import { pitchesLimiter } from "@/lib/limits";
import type { ActionState } from "@/lib/action-state";

function toActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof NotFoundError) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: fallback };
}

function checkRate(userId: string): ActionState | null {
  const r = pitchesLimiter(userId);
  if (!r.ok) {
    return {
      ok: false,
      error: `Rate limit reached. Try again in ${Math.ceil(r.retryAfterMs / 1000)}s.`,
    };
  }
  return null;
}

export async function changeSubscriptionPlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const rawPlan = String(formData.get("plan") ?? "starter").trim();
    const plan: PlanTier =
      rawPlan === "enterprise" ? "enterprise" : rawPlan === "starter" ? "starter" : "free";
    const rawInterval = String(formData.get("billingInterval") ?? "monthly").trim();
    const billingInterval: BillingInterval = (BILLING_INTERVALS as readonly string[]).includes(
      rawInterval,
    )
      ? (rawInterval as BillingInterval)
      : "monthly";

    const res = await changeSubscriptionPlan(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      plan,
      billingInterval,
    });

    revalidatePath("/settings/billing");
    revalidatePath("/pitches");
    return {
      ok: true,
      message:
        res.plan === "free"
          ? "Switched organization subscription to Free plan."
          : `Upgraded to ${res.plan.toUpperCase()} (${res.billingInterval}) plan! Granted +${res.monthlyCredits.toLocaleString()} monthly credits (Org pool balance: ${res.orgBalance.toLocaleString()}).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to update subscription plan.");
  }
}

export async function purchaseCreditPackAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const rawPack = String(formData.get("packId") ?? "pack_1k").trim();
    const packId: CreditPackId =
      rawPack === "pack_15k" ? "pack_15k" : rawPack === "pack_5k" ? "pack_5k" : "pack_1k";

    const rawScope = String(formData.get("targetScope") ?? "organization").trim();
    let targetScope: "organization" | "website" | "group" = "organization";
    let targetWebsiteId: string | null = null;
    let targetGroupId: string | null = null;

    if (rawScope.startsWith("website:")) {
      targetScope = "website";
      targetWebsiteId = rawScope.slice("website:".length);
    } else if (rawScope.startsWith("group:")) {
      targetScope = "group";
      targetGroupId = rawScope.slice("group:".length);
    }

    const res = await purchaseCreditPack(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      packId,
      targetScope,
      targetWebsiteId,
      targetGroupId,
    });

    revalidatePath("/settings/billing");
    if (targetGroupId) revalidatePath(`/group/${targetGroupId}`);
    return {
      ok: true,
      message: `Purchased +${res.creditsAdded.toLocaleString()} credits pack (Updated pool balance: ${res.newPoolBalance.toLocaleString()} credits). Invoice issued.`,
    };
  } catch (err) {
    return toActionError(err, "Failed to purchase credit pack.");
  }
}

export async function toggleBillingAddonAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const rawAddon = String(formData.get("addonId") ?? "api_mcp_addon").trim();
    const addonId: BillingAddonId =
      rawAddon === "pitch_pro_addon" ? "pitch_pro_addon" : "api_mcp_addon";
    const enabled = String(formData.get("enabled") ?? "true") === "true";

    const res = await toggleBillingAddon(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      addonId,
      enabled,
    });

    revalidatePath("/settings/billing");
    revalidatePath("/settings/api");
    return {
      ok: true,
      message: enabled
        ? `Activated add-on "${addonId}"${
            res.bonusCreditsGranted > 0
              ? ` and granted +${res.bonusCreditsGranted.toLocaleString()} bonus credits.`
              : "."
          }`
        : `Deactivated add-on "${addonId}".`,
    };
  } catch (err) {
    return toActionError(err, "Failed to update billing add-on.");
  }
}

export async function allocateWebsiteCreditsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const websiteId = String(formData.get("websiteId") ?? "").trim();
    const amount = Number(formData.get("amount") ?? 0);
    const rawDirection = String(formData.get("direction") ?? "to_website").trim();
    const direction = rawDirection === "to_org" ? "to_org" : "to_website";
    const reason = String(formData.get("reason") ?? "").trim() || undefined;

    const res = await allocateWebsiteCredits(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      websiteId,
      amount,
      direction,
      reason,
    });

    revalidatePath("/settings/billing");
    return {
      ok: true,
      message:
        direction === "to_website"
          ? `Allocated ${amount.toLocaleString()} credits to website pool (Website balance: ${res.websiteBalance.toLocaleString()} · Org pool: ${res.orgBalance.toLocaleString()}).`
          : `Returned ${amount.toLocaleString()} credits to organization pool (Website balance: ${res.websiteBalance.toLocaleString()} · Org pool: ${res.orgBalance.toLocaleString()}).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to allocate website credits.");
  }
}
