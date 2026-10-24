import { getTranslations } from "@/lib/i18n/server";
import { eq } from "drizzle-orm";
import { db, organizations } from "@athena/db";
import { listGroups } from "@athena/core/org";
import { SettingsShell } from "@/components/settings-shell";
import { ActionForm } from "@/components/action-form";
import { getSettingsContext } from "@/lib/settings-context";
import { saveOrganization, saveWebsite, removeWebsite, addGroup, assignGroup } from "../actions";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Settings — General") };
}

const TIMEZONES = Intl.supportedValuesOf("timeZone");

export default async function GeneralSettingsPage() {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, s.organizationId));
  const groups = await listGroups(db, { actorId: s.user.id, organizationId: s.organizationId });
  const canOrg = s.can("settings:write");
  const canSites = s.can("websites:write");

  return (
    <SettingsShell active="general" title={tt("General Settings")} subtitle={tt("Organization and website preferences")}>
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">{tt("Organization")}</h2>
          <ActionForm action={saveOrganization} submitLabel={tt("Save organization")} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Organization name")}</span>
              <input name="name" className="input" defaultValue={org?.name} required maxLength={120} disabled={!canOrg} />
            </label>
            <p className="text-xs text-gray-400">
              {tt("Plan: ")}<span className="font-medium text-gray-600">{tt(org?.plan)}</span> {tt(" · Slug: ")}<code>{org?.slug}</code>
            </p>
          </ActionForm>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">{tt("Website — ")}{s.website.domain}</h2>
          <ActionForm action={saveWebsite} submitLabel={tt("Save website")} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Brand name")}</span>
              <input name="name" className="input" defaultValue={s.website.name} required maxLength={120} disabled={!canSites} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Default country (ISO)")}</span>
                <input name="country" className="input uppercase" defaultValue={s.website.country} maxLength={2} required disabled={!canSites} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">{tt("Timezone")}</span>
                <select name="timezone" className="input" defaultValue={s.website.timezone} disabled={!canSites}>
                  <option value="UTC">{tt("UTC")}</option>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </ActionForm>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">{tt("Groups")}</h2>
          <p className="mb-3 text-xs text-gray-500">{tt("Group websites (e.g. an agency portfolio) to share access and credits.")}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <ActionForm action={assignGroup} submitLabel={tt("Move website")} variant="secondary" className="space-y-2">
              <select name="groupId" className="input" defaultValue={s.website.groupId ?? ""} disabled={!canSites}>
                <option value="">{tt("No group")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </ActionForm>
            {canSites ? (
              <ActionForm action={addGroup} submitLabel={tt("Create group")} variant="secondary" className="space-y-2">
                <input name="name" className="input" placeholder={tt("New group name")} required maxLength={80} />
              </ActionForm>
            ) : null}
          </div>
        </section>

        {canSites ? (
          <section className="rounded-xl border border-red-100 p-4">
            <h2 className="text-sm font-semibold text-red-700">{tt("Delete website")}</h2>
            <p className="mb-3 mt-1 text-xs text-gray-500">
              {tt("Stops tracking and hides all data for ")}{s.website.domain}{tt(". Type the domain to confirm.")}</p>
            <ActionForm action={removeWebsite} submitLabel={tt("Delete website")} variant="danger" className="space-y-2" confirm={tt("Delete this website?")}>
              <input name="confirm" className="input" placeholder={tt(s.website.domain)} required />
            </ActionForm>
          </section>
        ) : null}
      </div>
    </SettingsShell>
  );
}
