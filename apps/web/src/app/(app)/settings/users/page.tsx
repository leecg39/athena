import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { listMembers, listInvites, listCustomRoles, PERMISSIONS } from "@athena/core/org";
import { SettingsShell } from "@/components/settings-shell";
import { ActionForm } from "@/components/action-form";
import { getSettingsContext } from "@/lib/settings-context";
import { inviteMember, cancelInvite, updateRole, deleteMember, addCustomRole, removeCustomRole } from "../actions";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Settings — Users") };
}

const BUILT_IN = ["owner", "admin", "billing", "member"] as const;

export default async function UsersSettingsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  if (!s.can("members:read")) {
    return (
      <SettingsShell active="users" title={tt("Users")}>
        <p className="text-sm text-gray-500">{tt("Your role does not include access to the member list.")}</p>
      </SettingsShell>
    );
  }
  const q = { actorId: s.user.id, organizationId: s.organizationId };
  const [members, invites, roles] = await Promise.all([listMembers(db, q), listInvites(db, q), listCustomRoles(db, q)]);
  const canManage = s.can("members:write");
  const roleLabel = (role: string, customRoleId: string | null) =>
    role === "custom" ? `custom: ${roles.find((r) => r.id === customRoleId)?.name ?? "?"}` : role;

  return (
    <SettingsShell active="users" title={tt("Users")} subtitle={tt("Members, roles, invites and access scopes")}>
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">{tt("Members (")}{members.length})</h2>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{tt("Member")}</th>
                  <th>{tt("Role")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId}>
                    <td>
                      <div className="font-medium text-gray-900">{m.name ?? m.email}</div>
                      <div className="text-xs text-gray-400">{m.email}</div>
                    </td>
                    <td>
                      {canManage ? (
                        <ActionForm action={updateRole} submitLabel={tt("Update")} variant="secondary" className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={m.userId} />
                          <select
                            name="role"
                            className="input !w-44 !py-1 text-xs"
                            defaultValue={m.role === "custom" ? `custom:${m.customRoleId}` : m.role}
                            aria-label={tt("Role for {0}", { 0: m.email })}
                          >
                            {BUILT_IN.map((r) => (
                              <option key={r} value={r}>
                                {tt(r)}
                              </option>
                            ))}
                            {roles.map((r) => (
                              <option key={r.id} value={`custom:${r.id}`}>
                                {tt("custom: ")}{r.name}
                              </option>
                            ))}
                          </select>
                        </ActionForm>
                      ) : (
                        <span className="badge bg-gray-100 text-gray-600">{tt(roleLabel(m.role, m.customRoleId))}</span>
                      )}
                    </td>
                    <td className="text-right">
                      {canManage || m.userId === s.user.id ? (
                        <ActionForm
                          action={deleteMember}
                          submitLabel={tt(m.userId === s.user.id ? "Leave" : "Remove")}
                          variant="secondary"
                          confirm={tt(m.userId === s.user.id ? "Leave this organization?" : `Remove ${m.email}?`)}
                        >
                          <input type="hidden" name="userId" value={m.userId} />
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canManage ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-900">{tt("Invite a teammate")}</h2>
            <ActionForm action={inviteMember} submitLabel={tt("Send invite")} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <input name="email" type="email" className="input md:col-span-1" placeholder={tt("name@company.com")} required />
                <select name="role" className="input" defaultValue="member" aria-label={tt("Role")}>
                  {BUILT_IN.filter((r) => r !== "owner" || s.membership.role === "owner").map((r) => (
                    <option key={r} value={r}>
                      {tt(r)}
                    </option>
                  ))}
                  {roles.length ? <option value="custom">{tt("custom role…")}</option> : null}
                </select>
                <select name="scope" className="input" defaultValue="organization" aria-label={tt("Access scope")}>
                  <option value="organization">{tt("Role-based access")}</option>
                  <option value="website">{tt("Only ")}{s.website.name}</option>
                </select>
              </div>
              {roles.length ? (
                <select name="customRoleId" className="input" defaultValue="" aria-label={tt("Custom role (when role is custom)")}>
                  <option value="">{tt("— custom role (only when role = custom) —")}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <p className="text-xs text-gray-400">
                {tt("Owners, admins and billing users see every website. Members and custom roles see only websites they are added to.")}</p>
            </ActionForm>
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">{tt("Invitations")}</h2>
          {invites.length === 0 ? (
            <p className="text-xs text-gray-400">{tt("No invitations yet.")}</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>
                    {i.email} <span className="text-xs text-gray-400">· {tt(i.role)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={`badge ${i.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                      {i.status === "pending" && i.expiresAt < new Date() ? "expired" : i.status}
                    </span>
                    {canManage && i.status === "pending" ? (
                      <ActionForm action={cancelInvite} submitLabel={tt("Revoke")} variant="secondary">
                        <input type="hidden" name="inviteId" value={i.id} />
                      </ActionForm>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">{tt("Custom roles")}</h2>
          <p className="mb-3 text-xs text-gray-500">{tt("Permission sets you can assign instead of a built-in role.")}</p>
          <ul className="mb-4 space-y-2">
            {roles.map((r) => (
              <li key={r.id} className="flex items-start justify-between rounded-lg border border-gray-100 p-3">
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.permissions.map((p) => (
                      <span key={tt(p)} className="badge bg-gray-100 text-gray-600">
                        {tt(p)}
                      </span>
                    ))}
                  </div>
                </div>
                {canManage ? (
                  <ActionForm action={removeCustomRole} submitLabel={tt("Delete")} variant="secondary" confirm={tt("Delete role {0}?", { 0: r.name })}>
                    <input type="hidden" name="roleId" value={r.id} />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <ActionForm action={addCustomRole} submitLabel={tt("Create role")} variant="secondary" className="space-y-3 rounded-xl border border-gray-100 p-4">
              <input name="name" className="input" placeholder={tt("Role name, e.g. Content editor")} required maxLength={60} />
              <fieldset className="grid grid-cols-2 gap-1 md:grid-cols-3">
                <legend className="mb-1 text-xs font-medium text-gray-600">{tt("Permissions")}</legend>
                {PERMISSIONS.map((p) => (
                  <label key={tt(p)} className="flex items-center gap-2 text-xs text-gray-700">
                    <input type="checkbox" name="permissions" value={tt(p)} /> {tt(p)}
                  </label>
                ))}
              </fieldset>
            </ActionForm>
          ) : null}
        </section>
      </div>
    </SettingsShell>
  );
}
