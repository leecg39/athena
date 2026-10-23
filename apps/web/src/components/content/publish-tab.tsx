"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { publishContentItemAction, markPublishedAction } from "@/app/(app)/content/actions";
import type { SerializedPublishTarget } from "./cms-panel";

const idle: ActionState = { ok: false };
const EXPORT_OPTIONS = [
  ["wordpress", "WordPress"],
  ["webflow", "Webflow"],
  ["contentful", "Contentful"],
  ["sanity", "Sanity"],
  ["wix", "Wix"],
  ["framer", "Framer"],
  ["payload", "Payload CMS"],
  ["shopify", "Shopify"],
] as const;

export function PublishTab(props: { item: { id: string; status: string; targetUrl: string | null; hasVersion: boolean }; targets: SerializedPublishTarget[]; canWrite: boolean }) {
  const [pubState, pubAct, publishing] = useActionState(publishContentItemAction, idle);
  const [markState, markAct, marking] = useActionState(markPublishedAction, idle);
  const direct = props.targets.filter((t) => t.mode === "direct" && t.configured);
  const msg = pubState.error ?? markState.error ?? pubState.message ?? markState.message;
  if (!props.item.hasVersion) return <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">Write or generate a draft before publishing.</p>;
  return (
    <div className="space-y-4 text-xs">
      {msg ? <p className={pubState.error || markState.error ? "text-red-600" : "text-emerald-700"} role="status">{msg}</p> : null}
      <section className="space-y-2">
        <h4 className="font-semibold text-gray-800">Publish directly</h4>
        {direct.length && props.canWrite ? (
          <form action={pubAct} className="flex items-center gap-2">
            <input type="hidden" name="contentId" value={props.item.id} />
            <select name="provider" className="input max-w-40 !py-1 text-xs" aria-label="Publish to">
              {direct.map((t) => (
                <option key={t.id} value={t.provider}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="submit" data-testid="content-publish-btn" disabled={publishing} className="btn-primary !px-3 !py-1.5 text-xs">
              {publishing ? "Publishing…" : "Publish latest version"}
            </button>
          </form>
        ) : (
          <p className="text-gray-500">Connect WordPress or Shopify under “CMS connections” to publish with one click.</p>
        )}
      </section>
      <section className="space-y-2">
        <h4 className="font-semibold text-gray-800">Export for another CMS</h4>
        <form method="get" action={`/api/content/${props.item.id}/export`} className="flex items-center gap-2">
          <select name="provider" className="input max-w-40 !py-1 text-xs" aria-label="Export for">
            {EXPORT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-secondary !px-3 !py-1.5 text-xs">
            Download JSON (title, slug, Markdown, HTML)
          </button>
        </form>
      </section>
      {props.canWrite ? (
        <section className="space-y-2">
          <h4 className="font-semibold text-gray-800">Already live?</h4>
          <form action={markAct} className="flex items-center gap-2">
            <input type="hidden" name="contentId" value={props.item.id} />
            <input name="url" required defaultValue={props.item.targetUrl ?? ""} placeholder="https://your-site.com/page" className="input !py-1 text-xs" aria-label="Live URL" />
            <button type="submit" disabled={marking} className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs">
              {marking ? "Checking…" : "Check page & mark published"}
            </button>
          </form>
          <p className="text-gray-400">We load the page and mark it published only if it shows this item&apos;s title.</p>
        </section>
      ) : null}
    </div>
  );
}
