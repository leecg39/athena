import { SettingsShell } from "@/components/settings-shell";

export const metadata = { title: "Settings — Profile" };

function Field(props: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{props.label}</span>
      <input className="input" defaultValue={props.value} />
    </label>
  );
}

export default function ProfileSettingsPage() {
  return (
    <SettingsShell active="profile" title="Profile Settings" subtitle="Your personal account details">
      <form className="space-y-4">
        <Field label="Full name" value="Demo User" />
        <Field label="Email" value="demo@example.com" />
        <Field label="Job title" value="Head of AI Search" />
        <button className="btn-primary">Save changes</button>
      </form>
    </SettingsShell>
  );
}
