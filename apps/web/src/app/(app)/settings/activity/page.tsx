import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { db } from "@athena/db";
import { listActivity } from "@athena/core/org";
import { SettingsShell } from "@/components/settings-shell";
import { getSettingsContext } from "@/lib/settings-context";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Activity Log") };
}

const PAGE = 50;

function summarize(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  return Object.entries(v as Record<string, unknown>)
    .map(([k, val]) => `${k}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`)
    .join(", ")
    .slice(0, 160);
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  const tt = await getTranslations();
  const s = await getSettingsContext();
  if (!s.can("activity:read")) {
    return (
      <SettingsShell active="activity" title={tt("Activity Log")}>
        <p className="text-sm text-gray-500">{tt("You do not have access to the activity log.")}</p>
      </SettingsShell>
    );
  }
  const { after } = await searchParams;
  const rows = await listActivity(db, { actorId: s.user.id, organizationId: s.organizationId, limit: PAGE, cursor: after });
  const last = rows.at(-1);
  return (
    <SettingsShell active="activity" title={tt("Activity Log")} subtitle={tt("Audit trail of changes across your organization")}>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">{tt("No activity recorded")}{tt(after ? " before this point" : " yet")}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>{tt("When")}</th>
                <th>{tt("Actor")}</th>
                <th>{tt("Entity")}</th>
                <th>{tt("Change")}</th>
                <th>{tt("Detail")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-xs text-gray-400">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="text-xs text-gray-600">{a.actorEmail ?? "system"}</td>
                  <td>
                    <span className="badge bg-gray-100 text-gray-600">{a.entityType}</span>
                  </td>
                  <td>
                    <span className="badge bg-brand-50 text-brand-600">{a.change}</span>
                  </td>
                  <td className="text-xs text-gray-500">{summarize(a.after) || summarize(a.before)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === PAGE && last ? (
        <Link href={`/settings/activity?after=${encodeURIComponent(last.id)}`} className="mt-4 inline-block text-sm text-brand-600">
          {tt("Older entries →")}</Link>
      ) : null}
    </SettingsShell>
  );
}
