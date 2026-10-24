"use client";
import { useTranslations } from "@/components/locale-provider";


import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { reviseWithAthenaAction } from "@/app/(app)/content/actions";

const idle: ActionState = { ok: false };
const PRESETS = [
  "Add a comparison table and cite the confirmed Knowledge Base facts",
  "Strengthen the FAQ with direct question-and-answer blocks",
  "Tighten the short answer at the top and remove repetition",
];

/** AI revision of the latest version; needs a configured AI provider. */
export function ReviseTab(props: { contentId: string; canWrite: boolean; onRevised: () => void }) {
  const tt = useTranslations();
  const [instruction, setInstruction] = useState<string | null>(null);
  const displayedInstruction = instruction ?? tt(PRESETS[0]);
  const [state, act, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const next = await reviseWithAthenaAction(prev, fd);
    if (next.ok) props.onRevised();
    return next;
  }, idle);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button key={preset} type="button" onClick={() => setInstruction(tt(preset))} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700 hover:border-brand-300 hover:bg-brand-50">
            {tt(preset)}
          </button>
        ))}
      </div>
      <form action={act} className="space-y-3">
        <input type="hidden" name="contentId" value={props.contentId} />
        <textarea name="instruction" value={displayedInstruction} onChange={(e) => setInstruction(e.target.value)} rows={3} required placeholder={tt("Describe how Athena should revise this article…")} className="w-full rounded-xl border border-gray-200 p-3 text-sm text-gray-800" />
        {state.error || state.message ? <p className={`text-xs ${state.error ? "text-red-600" : "text-emerald-700"}`} role="status">{tt(state.error ?? state.message)}</p> : null}
        <div className="flex justify-end">
          <button type="submit" disabled={pending || !props.canWrite} className="btn-primary !px-4 !py-2 text-xs">
            {tt(pending ? "Athena revising…" : "✎ Revise with Athena → new version")}
          </button>
        </div>
      </form>
    </div>
  );
}
