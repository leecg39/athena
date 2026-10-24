import { getTranslations } from "@/lib/i18n/server";
import { eq } from "drizzle-orm";
import { db, users } from "@athena/db";
import { SettingsShell } from "@/components/settings-shell";
import { ActionForm } from "@/components/action-form";
import { getSettingsContext } from "@/lib/settings-context";
import { saveProfile } from "../actions";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Settings — Profile") };
}

export default async function ProfileSettingsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const [me] = await db.select().from(users).where(eq(users.id, s.user.id));
  return (
    <SettingsShell active="profile" title={tt("Profile Settings")} subtitle={tt("Your personal account details")}>
      <ActionForm action={saveProfile} submitLabel={tt("Save changes")} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Full name")}</span>
          <input name="name" className="input" defaultValue={me?.name ?? ""} required maxLength={120} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Email")}</span>
          <input className="input bg-gray-50" value={me?.email ?? ""} readOnly aria-readonly />
          <span className="mt-1 block text-xs text-gray-400">{tt("Your sign-in email cannot be changed here.")}</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Job title")}</span>
          <input name="jobTitle" className="input" defaultValue={me?.jobTitle ?? ""} maxLength={120} />
        </label>
        <p className="text-xs text-gray-400">
          {tt("Role in this organization: ")}<span className="font-medium text-gray-600">{tt(s.membership.role)}</span>
        </p>
      </ActionForm>
    </SettingsShell>
  );
}
