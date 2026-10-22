import { eq } from "drizzle-orm";
import { db, users } from "@athena/db";
import { SettingsShell } from "@/components/settings-shell";
import { ActionForm } from "@/components/action-form";
import { getSettingsContext } from "@/lib/settings-context";
import { saveProfile } from "../actions";

export const metadata = { title: "Settings — Profile" };

export default async function ProfileSettingsPage() {
  const s = await getSettingsContext();
  const [me] = await db.select().from(users).where(eq(users.id, s.user.id));
  return (
    <SettingsShell active="profile" title="Profile Settings" subtitle="Your personal account details">
      <ActionForm action={saveProfile} submitLabel="Save changes" className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Full name</span>
          <input name="name" className="input" defaultValue={me?.name ?? ""} required maxLength={120} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Email</span>
          <input className="input bg-gray-50" value={me?.email ?? ""} readOnly aria-readonly />
          <span className="mt-1 block text-xs text-gray-400">Your sign-in email cannot be changed here.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Job title</span>
          <input name="jobTitle" className="input" defaultValue={me?.jobTitle ?? ""} maxLength={120} />
        </label>
        <p className="text-xs text-gray-400">
          Role in this organization: <span className="font-medium text-gray-600">{s.membership.role}</span>
        </p>
      </ActionForm>
    </SettingsShell>
  );
}
