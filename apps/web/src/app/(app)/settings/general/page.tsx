import { SettingsShell } from "@/components/settings-shell";

export const metadata = { title: "Settings — General" };

function Field(props: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{props.label}</span>
      <input className="input" defaultValue={props.value} />
    </label>
  );
}

export default function GeneralSettingsPage() {
  return (
    <SettingsShell active="general" title="General Settings" subtitle="Organization name, defaults and workspace preferences">
      <form className="space-y-4">
        <Field label="Organization name" value="Demo Org" />
        <Field label="Default country" value="US" />
        <Field label="Timezone" value="UTC" />
        <button className="btn-primary">Save changes</button>
      </form>
    </SettingsShell>
  );
}
