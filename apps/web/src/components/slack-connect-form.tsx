"use client";
import { useTranslations } from "@/components/locale-provider";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { connectSlackAction, disconnectSlackAction } from "@/app/(app)/settings/integrations/actions";

const idle: ActionState = { ok: false };

/** Slack incoming webhook for report summaries (the URL is stored encrypted and never shown again). */
export function SlackConnectForm(props: { connected: boolean; channel: string | null; canWrite: boolean }) {
  const tt = useTranslations();
  const [connectState, connectAct, connecting] = useActionState(connectSlackAction, idle);
  const [disconnectState, disconnectAct, disconnecting] = useActionState(disconnectSlackAction, idle);
  const state = disconnectState.error || disconnectState.message ? disconnectState : connectState;
  return (
    <div className="space-y-2 rounded-lg border border-gray-100 p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-700">{tt("Slack (report summaries)")}</div>
          <div className="text-[11px] text-gray-400">{props.connected ? (props.channel ?? tt("Incoming webhook")) : tt("Create an incoming webhook in your Slack app, then paste its URL here")}</div>
        </div>
        {props.connected ? <span className="badge bg-emerald-50 text-emerald-700">{tt("Connected")}</span> : <span className="badge bg-gray-100 text-gray-500">{tt("Not connected")}</span>}
      </div>
      {props.canWrite ? (
        <form action={connectAct} className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
          <input name="webhookUrl" type="password" autoComplete="off" required placeholder="https://hooks.slack.com/services/…" className="rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-xs" />
          <input name="channel" placeholder={tt("#aeo-weekly")} className="rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-xs" />
          <button type="submit" disabled={connecting} className="btn-secondary !px-3 !py-1.5 text-xs">{tt(props.connected ? "Replace webhook" : "Connect")}</button>
        </form>
      ) : null}
      {props.canWrite && props.connected ? (
        <form action={disconnectAct}>
          <button type="submit" disabled={disconnecting} className="text-xs text-red-500 hover:text-red-700">{tt("Disconnect Slack")}</button>
        </form>
      ) : null}
      {state.error ? <div role="alert" className="text-xs text-red-600">{tt(state.error)}</div> : state.message ? <div role="status" className="text-xs text-emerald-700">{tt(state.message)}</div> : null}
    </div>
  );
}
