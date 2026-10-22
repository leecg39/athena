"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import {
  DomainError,
  ForbiddenError,
  NotFoundError,
  createGroup,
  setWebsiteGroup,
} from "@athena/core/org";
import {
  allocateGroupCredits,
  createGroupSavedView,
  deleteGroupSavedView,
} from "@athena/core/pitches";
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

export async function createGroupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const name = String(formData.get("name") ?? "").trim();
    const created = await createGroup(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      name,
    });

    revalidatePath(`/group/${created.id}`);
    revalidatePath("/pitches");
    return {
      ok: true,
      message: `Created portfolio group "${created.name}".`,
    };
  } catch (err) {
    return toActionError(err, "Failed to create group.");
  }
}

export async function assignWebsiteGroupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const websiteId = String(formData.get("websiteId") ?? "").trim();
    const rawGroupId = String(formData.get("groupId") ?? "").trim();
    const groupId = rawGroupId === "" || rawGroupId === "none" ? null : rawGroupId;
    const currentGroupId = String(formData.get("currentGroupId") ?? "").trim();

    await setWebsiteGroup(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      websiteId,
      groupId,
    });

    if (currentGroupId) revalidatePath(`/group/${currentGroupId}`);
    if (groupId) revalidatePath(`/group/${groupId}`);
    return {
      ok: true,
      message: groupId
        ? "Assigned website to group portfolio."
        : "Removed website from group portfolio.",
    };
  } catch (err) {
    return toActionError(err, "Failed to update website group membership.");
  }
}

export async function allocateGroupCreditsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const groupId = String(formData.get("groupId") ?? "").trim();
    const amount = Number(formData.get("amount") ?? 0);
    const rawDirection = String(formData.get("direction") ?? "to_group").trim();
    const direction = rawDirection === "to_org" ? "to_org" : "to_group";
    const reason = String(formData.get("reason") ?? "").trim() || undefined;

    const result = await allocateGroupCredits(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      groupId,
      amount,
      direction,
      reason,
    });

    revalidatePath(`/group/${groupId}`);
    revalidatePath("/settings/billing");
    return {
      ok: true,
      message:
        direction === "to_group"
          ? `Allocated ${amount.toLocaleString()} shared credits to group (Group balance: ${result.groupBalance.toLocaleString()} · Org balance: ${result.orgBalance.toLocaleString()}).`
          : `Returned ${amount.toLocaleString()} credits to organization pool (Group balance: ${result.groupBalance.toLocaleString()} · Org balance: ${result.orgBalance.toLocaleString()}).`,
    };
  } catch (err) {
    return toActionError(err, "Failed to transfer shared group credits.");
  }
}

export async function createGroupSavedViewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const groupId = String(formData.get("groupId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const domainFilter = String(formData.get("domainFilter") ?? "").trim();

    const view = await createGroupSavedView(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      groupId,
      name,
      filters: { domainFilter },
    });

    revalidatePath(`/group/${groupId}`);
    return {
      ok: true,
      message: `Saved group view "${view.name}".`,
    };
  } catch (err) {
    return toActionError(err, "Failed to save group view.");
  }
}

export async function deleteGroupSavedViewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const s = await getSettingsContext();
    const limited = checkRate(s.user.id);
    if (limited) return limited;

    const groupId = String(formData.get("groupId") ?? "").trim();
    const viewId = String(formData.get("viewId") ?? "").trim();

    await deleteGroupSavedView(db, {
      actorId: s.user.id,
      organizationId: s.organizationId,
      groupId,
      viewId,
    });

    revalidatePath(`/group/${groupId}`);
    return {
      ok: true,
      message: "Deleted group saved view.",
    };
  } catch (err) {
    return toActionError(err, "Failed to delete group saved view.");
  }
}
