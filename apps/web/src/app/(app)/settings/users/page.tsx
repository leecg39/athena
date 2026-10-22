import { SettingsShell } from "@/components/settings-shell";

export const metadata = { title: "Settings — Users" };

const MEMBERS = [
  { email: "demo@example.com", role: "Owner", scope: "Organization" },
  { email: "analyst@company.com", role: "Member", scope: "Canvasly" },
  { email: "agency@partner.co", role: "Billing", scope: "Group: Portfolio" },
];

export default function UsersSettingsPage() {
  return (
    <SettingsShell active="users" title="Users" subtitle="Members, roles, invites and access scopes">
      <div className="mb-4 flex justify-between">
        <span className="text-sm text-gray-500">{MEMBERS.length} members</span>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs">Bulk invite to websites or groups</button>
          <button className="btn-primary text-xs">+ Invite</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="table-base">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Scope</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {MEMBERS.map((m) => (
              <tr key={m.email}>
                <td>{m.email}</td>
                <td>
                  <select className="input max-w-32 !py-1 text-xs" defaultValue={m.role}>
                    <option>Owner</option>
                    <option>Admin</option>
                    <option>Billing</option>
                    <option>Member</option>
                    <option>Custom</option>
                  </select>
                </td>
                <td className="text-gray-500">{m.scope}</td>
                <td className="text-right">
                  <button className="text-xs text-gray-400 hover:text-red-500">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-xl border border-gray-100 p-4">
        <div className="text-sm font-medium text-gray-900">Custom roles</div>
        <p className="mt-1 text-xs text-gray-400">
          Define permission sets (prompts:write, billing:read, …) and assign them per member.
        </p>
        <button className="btn-secondary mt-3 text-xs">+ Create custom role</button>
      </div>
    </SettingsShell>
  );
}
