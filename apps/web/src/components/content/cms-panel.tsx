"use client";
import { useTranslations } from "@/components/locale-provider";


import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { upsertPublishTargetAction, deletePublishTargetAction } from "@/app/(app)/content/actions";

const idle: ActionState = { ok: false };

export interface SerializedPublishTarget {
  id: string;
  provider: string;
  label: string;
  mode: "direct" | "export";
  configured: boolean;
  config: Record<string, string>;
}

/** Direct publishing exists for these CMSs; field names match the server's validation. */
const DIRECT: { value: "wordpress" | "shopify"; label: string; fields: { name: string; label: string; secret?: boolean; placeholder: string }[] }[] = [
  {
    value: "wordpress",
    label: "WordPress",
    fields: [
      { name: "siteUrl", label: "Site URL", placeholder: "https://blog.example.com" },
      { name: "username", label: "Username", placeholder: "editor" },
      { name: "applicationPassword", label: "Application password", secret: true, placeholder: "xxxx xxxx xxxx xxxx" },
    ],
  },
  {
    value: "shopify",
    label: "Shopify",
    fields: [
      { name: "storeDomain", label: "Store domain", placeholder: "your-store.myshopify.com" },
      { name: "blogId", label: "Blog ID", placeholder: "123456789" },
      { name: "accessToken", label: "Admin API access token", secret: true, placeholder: "shpat_…" },
      { name: "blogHandle", label: "Blog handle (optional)", placeholder: "news" },
    ],
  },
];

export function CmsPanel(props: { targets: SerializedPublishTarget[]; onClose: () => void }) {
  const tt = useTranslations();
  const [provider, setProvider] = useState<"wordpress" | "shopify">("wordpress");
  const [saveState, saveAct, saving] = useActionState(upsertPublishTargetAction, idle);
  const [delState, delAct, deleting] = useActionState(deletePublishTargetAction, idle);
  const spec = DIRECT.find((d) => d.value === provider)!;
  const existing = props.targets.find((t) => t.provider === provider);
  const msg = saveState.error ?? delState.error ?? saveState.message ?? delState.message;
  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{tt("CMS connections")}</div>
          <p className="mt-0.5 text-xs text-gray-500">
            {tt("Direct publishing works with WordPress (Application Password) and Shopify (Admin API token). Secrets are encrypted at rest. For Webflow, Contentful, Sanity, Wix, Framer and Payload, use Export in an item's Publish tab.")}</p>
        </div>
        <button type="button" onClick={props.onClose} className="text-xs text-gray-400 hover:text-gray-600">
          {tt("Close")}</button>
      </div>
      <form action={saveAct} className="grid gap-3 md:grid-cols-5" key={provider}>
        <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as "wordpress" | "shopify")} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" aria-label={tt("CMS")}>
          {DIRECT.map((d) => (
            <option key={d.value} value={d.value}>
              {tt(d.label)} {props.targets.some((t) => t.provider === d.value && t.configured) ? "(connected)" : ""}
            </option>
          ))}
        </select>
        {spec.fields.map((f) => (
          <input
            key={f.name}
            name={f.name}
            type={f.secret ? "password" : "text"}
            aria-label={tt(f.label)}
            placeholder={tt(existing?.config[f.name] ? `${f.label}: ${existing.config[f.name]}` : f.placeholder)}
            autoComplete="off"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        ))}
        <button type="submit" disabled={saving} className="btn-primary !px-3 !py-2 text-xs">
          {tt(saving ? "Saving…" : existing ? "Update connection" : "Connect")}
        </button>
      </form>
      {msg ? <p className={`text-xs ${saveState.error || delState.error ? "text-red-600" : "text-emerald-700"}`} role="status">{tt(msg)}</p> : null}
      {props.targets.length ? (
        <ul className="grid gap-2 md:grid-cols-3">
          {props.targets.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-gray-800">{tt(t.label)}</div>
                <div className="truncate text-[11px] text-gray-400">{tt(t.mode === "export" ? "Export only (legacy connection)" : t.configured ? t.config.siteUrl || t.config.storeDomain : "Incomplete — add the missing fields")}</div>
              </div>
              <form action={delAct}>
                <input type="hidden" name="targetId" value={t.id} />
                <button type="submit" disabled={deleting} className="text-red-500 hover:underline">
                  {tt("Disconnect")}</button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
