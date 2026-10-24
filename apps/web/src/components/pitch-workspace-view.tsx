"use client";
import { useTranslations } from "@/components/locale-provider";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { PitchItem, PitchUsageSummary } from "@athena/core/pitches";
import type { ActionState } from "@/lib/action-state";
import { createPitchAction, deletePitchAction, writePitchRewriteAction } from "@/app/(app)/pitches/actions";

const idle: ActionState = { ok: false };
type Tt = ReturnType<typeof useTranslations>;
const pct = (v: number | undefined) => (v === undefined ? "—" : `${v}%`);

function CreatePitchForm({ tt, providers, credits, usage, onClose }: { tt: Tt; providers: string[]; credits: number; usage: PitchUsageSummary; onClose: () => void }) {
  const [state, act, pending] = useActionState(createPitchAction, idle);
  const [questions, setQuestions] = useState(0);
  const cost = questions * providers.length;
  return (
    <form action={act} className="space-y-4 rounded-xl border border-brand-200 bg-white p-5 shadow-sm">
      <div className="border-b border-gray-100 pb-3">
        <h2 className="text-sm font-semibold text-gray-900">{tt("Create a prospect pitch")}</h2>
        <p className="text-xs text-gray-500">{tt("The configured AI providers answer each buyer question; the pitch shows how often the prospect is mentioned, cited and ranked in those answers.")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{tt("Prospect website URL *")}</label>
          <input name="websiteUrl" required placeholder="https://linear.app" className="input-base w-full text-xs" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{tt("Prospect Brand Name (auto-detected if blank)")}</label>
          <input name="brandName" placeholder="Linear" className="input-base w-full text-xs" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{tt("Industry / Category")}</label>
          <input name="industry" className="input-base w-full text-xs" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">{tt("Buyer questions, one per line (1–5) *")}</label>
          <textarea name="prompts" rows={4} required onChange={(e) => setQuestions(Math.min(5, e.target.value.split("\n").filter((l) => l.trim()).length))} placeholder={tt("best issue tracking software for engineering teams")} className="input-base w-full text-xs" />
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">{tt("Competitors to compare (comma separated, up to 5)")}</label>
            <input name="competitors" placeholder="Jira, Asana" className="input-base w-full text-xs" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">{tt("Pitch type")}</label>
            <select name="kind" defaultValue="visibility" className="input-base w-full text-xs">
              <option value="visibility">{tt("AI search visibility audit")}</option>
              <option value="content">{tt("Visibility audit + content rewrite")}</option>
            </select>
          </div>
        </div>
      </div>
      <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
        {tt("Cost: 1 credit per AI answer ({0} questions × {1} providers = {2} credits; failed answers are refunded). Available: {3}.", { 0: questions, 1: providers.length, 2: cost, 3: credits })}
      </div>
      {state.error ? <div role="alert" className="text-xs text-red-600">{tt(state.error)}</div> : null}
      {state.message ? <div role="status" className="text-xs text-emerald-700">{tt(state.message)}</div> : null}
      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={onClose} className="btn-secondary !px-3 !py-1.5 text-xs">{tt("Cancel")}</button>
        <button type="submit" disabled={pending || usage.remaining <= 0 || !providers.length} className="btn-primary !px-4 !py-1.5 text-xs font-semibold disabled:opacity-50">
          {tt(pending ? "Collecting answers… this can take a minute" : "Collect answers and create pitch")}
        </button>
      </div>
    </form>
  );
}

function PitchRow({ p, tt, selected, onSelect, canWrite }: { p: PitchItem; tt: Tt; selected: boolean; onSelect: () => void; canWrite: boolean }) {
  const [, deleteAct, deleting] = useActionState(deletePitchAction, idle);
  const t = p.payload?.totals;
  return (
    <tr onClick={onSelect} className={`cursor-pointer transition ${selected ? "bg-brand-50/40" : "hover:bg-gray-50"}`}>
      <td>
        <div className="font-semibold text-gray-900">{p.brandName}</div>
        <div className="font-mono text-[11px] text-gray-400">{p.websiteUrl}</div>
      </td>
      <td>{t ? t.answers : <span className="text-[11px] text-gray-400">{tt("No measurements (made by an earlier version)")}</span>}</td>
      <td className="font-mono text-xs">{pct(t?.mentionRatePct)}</td>
      <td className="font-mono text-xs">{pct(t?.citationRatePct)}</td>
      <td className="font-mono text-xs">{pct(t?.shareOfVoicePct)}</td>
      <td>{p.payload ? <a href={p.sharePath} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-brand-600 underline">{tt("Open")}</a> : "—"}</td>
      <td className="text-right" onClick={(e) => e.stopPropagation()}>
        {canWrite ? (
          <form action={deleteAct}>
            <input type="hidden" name="pitchId" value={p.id} />
            <button type="submit" disabled={deleting} className="text-xs text-red-500 hover:text-red-700">{tt("Delete")}</button>
          </form>
        ) : null}
      </td>
    </tr>
  );
}

function PitchDetail({ p, tt, canWrite }: { p: PitchItem; tt: Tt; canWrite: boolean }) {
  const [state, act, pending] = useActionState(writePitchRewriteAction, idle);
  const payload = p.payload;
  if (!payload) return null;
  return (
    <div className="metric-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{p.brandName}</h3>
          <p className="text-xs text-gray-500">{tt("{0} answers collected on {1} from {2}", { 0: payload.totals.answers, 1: payload.collectedAt.slice(0, 10), 2: payload.models.join(", ") })}{payload.totals.simulatedSharePct > 0 ? ` · ${tt("includes simulated answers")}` : ""}</p>
        </div>
        <a href={p.sharePath} className="btn-primary !px-3.5 !py-1.5 text-xs font-medium">{tt("Open Public Pitch View →")}</a>
      </div>
      <table className="table-base text-xs">
        <thead><tr><th>{tt("Model")}</th><th>{tt("Answers")}</th><th>{tt("Mention Rate")}</th><th>{tt("Citation Rate")}</th></tr></thead>
        <tbody>{payload.byModel.map((m) => <tr key={m.model}><td>{m.model}</td><td>{m.answers}</td><td>{m.mentionRatePct}%</td><td>{m.citationRatePct}%</td></tr>)}</tbody>
      </table>
      {payload.rewrite ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs"><div className="mb-1 font-semibold text-gray-500">{tt("Before")}</div><div className="whitespace-pre-wrap">{payload.rewrite.beforeCopy}</div></div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 text-xs"><div className="mb-1 font-semibold text-emerald-800">{tt("After")} · {payload.rewrite.writtenBy}</div><div className="whitespace-pre-wrap">{payload.rewrite.afterCopy}</div></div>
        </div>
      ) : null}
      {canWrite ? (
        <form action={act} className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3.5">
          <input type="hidden" name="pitchId" value={p.id} />
          <div className="text-xs font-semibold text-gray-900">{tt("Content rewrite of the prospect's page")}</div>
          <div className="text-[11px] text-gray-500">{tt("Paste the prospect's current page copy. The AI provider rewrites it to answer the focus question using only facts in the copy.")}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <input name="targetPageUrl" placeholder={`https://${p.domain}/…`} defaultValue={payload.rewrite?.targetPageUrl ?? ""} key={`u-${p.id}`} className="input-base text-xs" />
            <select name="focusPrompt" defaultValue={payload.rewrite?.focusPrompt ?? payload.prompts[0]} key={`f-${p.id}`} className="input-base text-xs">
              {payload.prompts.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <textarea name="existingCopy" rows={4} required defaultValue={payload.rewrite?.beforeCopy ?? ""} key={`c-${p.id}`} className="input-base w-full text-xs" />
          {state.error ? <div role="alert" className="text-xs text-red-600">{tt(state.error)}</div> : null}
          {state.message ? <div role="status" className="text-xs text-emerald-700">{tt(state.message)}</div> : null}
          <button type="submit" disabled={pending} className="btn-secondary w-full !py-1.5 text-xs font-semibold">{tt(pending ? "Writing…" : "Write rewrite with AI")}</button>
        </form>
      ) : null}
    </div>
  );
}

export function PitchWorkspaceView(props: { pitches: PitchItem[]; usage: PitchUsageSummary; group: { id: string; name: string } | null; providers: string[]; credits: number; canWrite: boolean }) {
  const tt = useTranslations();
  const [showWizard, setShowWizard] = useState(false);
  const [selectedId, setSelectedId] = useState(props.pitches[0]?.id ?? "");
  const active = props.pitches.find((p) => p.id === selectedId) ?? props.pitches[0] ?? null;
  const { usage } = props;
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="text-xs text-gray-600">
          {tt("Pitch usage this month:")} <strong className="font-mono">{usage.usedThisMonth} / {usage.monthlyLimit}</strong> ({tt(usage.plan)}) · {tt("Credits available: {0}", { 0: props.credits })} · {tt("AI providers: {0}", { 0: props.providers.length ? props.providers.join(", ") : tt("none configured") })}
        </div>
        <div className="flex items-center gap-2">
          <Link href={props.group ? `/group/${props.group.id}` : "/group"} className="btn-secondary !px-3.5 !py-2 text-xs font-medium">{tt("Group Dashboard")}</Link>
          {props.canWrite ? <button type="button" onClick={() => setShowWizard((v) => !v)} className="btn-primary !px-4 !py-2 text-xs font-semibold">{tt(showWizard ? "Close" : "+ Create Pitch")}</button> : null}
        </div>
      </div>
      {!props.providers.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{tt("No AI provider is configured. Pitches are measured from real AI answers, so add an API key (OpenAI, Anthropic, Perplexity, Gemini, xAI or DeepSeek) first.")}</div> : null}
      {showWizard ? <CreatePitchForm tt={tt} providers={props.providers} credits={props.credits} usage={usage} onClose={() => setShowWizard(false)} /> : null}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="table-base">
          <thead>
            <tr><th>{tt("Prospect Brand")}</th><th>{tt("Answers")}</th><th>{tt("Mention Rate")}</th><th>{tt("Citation Rate")}</th><th>{tt("Share of Voice (SOV)")}</th><th>{tt("Public Share Link")}</th><th className="text-right">{tt("Actions")}</th></tr>
          </thead>
          <tbody>
            {props.pitches.map((p) => <PitchRow key={p.id} p={p} tt={tt} selected={active?.id === p.id} onSelect={() => setSelectedId(p.id)} canWrite={props.canWrite} />)}
            {!props.pitches.length ? <tr><td colSpan={7} className="py-8 text-center text-xs text-gray-400">{tt("No pitches yet.")}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {active ? <PitchDetail p={active} tt={tt} canWrite={props.canWrite} /> : null}
    </div>
  );
}
