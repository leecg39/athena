import Link from "next/link";

const SETTINGS_NAV = [
  ["general", "General"],
  ["profile", "Profile"],
  ["users", "Users"],
  ["billing", "Billing"],
  ["security", "Security"],
  ["api", "API & Embed"],
  ["integrations", "Integrations"],
  ["activity", "Activity Log"],
] as const;

export function SettingsShell(props: { active: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex border-b border-gray-100">
        <div className="hidden w-48 shrink-0 border-r border-gray-100 p-3 md:block">
          {SETTINGS_NAV.map(([id, label]) => (
            <Link
              key={id}
              href={`/settings/${id}`}
              className={`block rounded-lg px-3 py-1.5 text-sm ${props.active === id ? "bg-brand-50 font-medium text-brand-600" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="flex-1">
          <div className="border-b border-gray-100 px-6 py-4">
            <h1 className="text-lg font-semibold text-gray-900">{props.title}</h1>
            {props.subtitle ? <p className="mt-0.5 text-sm text-gray-500">{props.subtitle}</p> : null}
          </div>
          <div className="max-w-3xl p-6">{props.children}</div>
        </div>
      </div>
    </div>
  );
}
