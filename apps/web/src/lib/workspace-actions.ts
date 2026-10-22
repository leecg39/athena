"use server";

import { redirect } from "next/navigation";
import { requireUser } from "./session";
import { setActiveWebsite } from "./workspace";
import { safeRedirect } from "./auth.config";

export async function switchWorkspace(formData: FormData): Promise<void> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");
  await setActiveWebsite(user.id, websiteId);
  redirect(safeRedirect(formData.get("returnTo"), "/olympus"));
}
