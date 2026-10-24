"use client";
import { useTranslations } from "@/components/locale-provider";


import { useActionState, useEffect, useRef, useState, useTransition, type SubmitEvent } from "react";
import type { CmsConnectionSchema } from "@athena/core/content";
import type { ActionState } from "@/lib/action-state";
import { upsertPublishTargetAction, deletePublishTargetAction } from "@/app/(app)/content/actions";

const idle: ActionState = { ok: false };

export interface SerializedPublishTarget {
  id: string;
  provider: string;
  label: string;
  configured: boolean;
  config: Record<string, string>;
}

/** Readable names for the select options the server defines. */
const OPTION_LABELS: Record<string, string> = {
  markdown: "Long text (Markdown)",
  richtext: "Rich Text",
  portableText: "Portable Text (block content)",
  html: "HTML string",
  lexical: "Rich text (Lexical)",
  us: "US",
  eu: "EU",
};

export function CmsPanel(props: { targets: SerializedPublishTarget[]; schema: CmsConnectionSchema; onClose: () => void }) {
  const tt = useTranslations();
  const [provider, setProvider] = useState(props.schema[0]?.provider ?? "wordpress");
  const [saveState, saveAct, saving] = useActionState(upsertPublishTargetAction, idle);
  const [delState, delAct, deleting] = useActionState(deletePublishTargetAction, idle);
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  const spec = props.schema.find((d) => d.provider === provider) ?? props.schema[0];
  const existing = props.targets.find((t) => t.provider === provider);
  const msg = saveState.error ?? delState.error ?? saveState.message ?? delState.message;
  // submitted by hand so a rejected value doesn't wipe what was typed; the fields are cleared once the connection is saved
  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => saveAct(data));
  }
  useEffect(() => {
    if (saveState.ok) formRef.current?.reset();
  }, [saveState]);
  if (!spec) return null;
  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <PanelHeader onClose={props.onClose} />
      {/* the CMS choice lives outside the form: a form reset must never change which CMS the fields are saved to */}
      <ProviderPicker schema={props.schema} targets={props.targets} value={provider} note={spec.note} onChange={setProvider} />
      <form ref={formRef} onSubmit={submit} className="space-y-3" key={provider}>
        <input type="hidden" name="provider" value={provider} />
        <div className="grid gap-3 md:grid-cols-3">
          {spec.fields.map((f) => (
            <ConnectionField key={f.key} field={f} saved={existing?.config[f.key]} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary !px-3 !py-2 text-xs">
            {tt(saving ? "Saving…" : existing ? "Update connection" : "Connect")}
          </button>
          {existing ? <span className="text-[11px] text-gray-400">{tt("Leave a field empty to keep its saved value.")}</span> : null}
        </div>
      </form>
      {msg ? <p className={`text-xs ${saveState.error || delState.error ? "text-red-600" : "text-emerald-700"}`} role="status">{tt(msg)}</p> : null}
      {props.targets.length ? <ConnectedTargets targets={props.targets} schema={props.schema} disconnect={delAct} disconnecting={deleting} /> : null}
    </div>
  );
}

type SchemaField = CmsConnectionSchema[number]["fields"][number];

function ConnectionField({ field: f, saved }: { field: SchemaField; saved: string | undefined }) {
  const tt = useTranslations();
  return (
    <label className="space-y-1 text-[11px] text-gray-500">
      <span>{tt(f.label)}{f.required ? " *" : ""}</span>
      {f.options ? (
        <select name={f.key} defaultValue={saved ?? f.options[0]} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
          {f.options.map((o) => (
            <option key={o} value={o}>
              {tt(OPTION_LABELS[o] ?? o)}
            </option>
          ))}
        </select>
      ) : (
        // placeholders are literal examples (field IDs such as "title"), so they are not translated
        <input name={f.key} type={f.secret ? "password" : "text"} placeholder={saved ?? f.placeholder} autoComplete="off" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800" />
      )}
    </label>
  );
}

function ConnectedTargets(props: { targets: SerializedPublishTarget[]; schema: CmsConnectionSchema; disconnect: (data: FormData) => void; disconnecting: boolean }) {
  const tt = useTranslations();
  // the first non-secret value identifies the connection (site URL, space, project…)
  const summary = (t: SerializedPublishTarget) => {
    const shown = props.schema.find((d) => d.provider === t.provider)?.fields.find((f) => !f.secret && t.config[f.key]);
    return shown ? t.config[shown.key] : "";
  };
  return (
    <ul className="grid gap-2 md:grid-cols-3">
      {props.targets.map((t) => (
        <li key={t.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-xs">
          <div className="min-w-0">
            <div className="font-medium text-gray-800">{tt(t.label)}</div>
            <div className="truncate text-[11px] text-gray-400">{t.configured ? summary(t) : tt("Incomplete — add the missing fields")}</div>
          </div>
          <form action={props.disconnect}>
            <input type="hidden" name="targetId" value={t.id} />
            <button type="submit" disabled={props.disconnecting} className="text-red-500 hover:underline">
              {tt("Disconnect")}</button>
          </form>
        </li>
      ))}
    </ul>
  );
}

function PanelHeader(props: { onClose: () => void }) {
  const tt = useTranslations();
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{tt("CMS connections")}</div>
        <p className="mt-0.5 text-xs text-gray-500">
          {tt("Publish directly to WordPress, Webflow, Contentful, Sanity, Wix, Framer, Payload CMS or Shopify. Secrets are encrypted at rest and never shown again.")}</p>
      </div>
      <button type="button" onClick={props.onClose} className="text-xs text-gray-400 hover:text-gray-600">
        {tt("Close")}</button>
    </div>
  );
}

function ProviderPicker<P extends string>(props: { schema: CmsConnectionSchema; targets: SerializedPublishTarget[]; value: P; note: string; onChange: (p: P) => void }) {
  const tt = useTranslations();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as P)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" aria-label={tt("CMS")}>
        {props.schema.map((d) => (
          <option key={d.provider} value={d.provider}>
            {tt(d.label)}{props.targets.some((t) => t.provider === d.provider && t.configured) ? ` ${tt("(connected)")}` : ""}
          </option>
        ))}
      </select>
      <p className="min-w-0 flex-1 text-[11px] text-gray-500">{tt(props.note)}</p>
    </div>
  );
}
