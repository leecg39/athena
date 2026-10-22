"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action with inline success/error feedback.
 * One-time secrets (API keys, invite links) are shown with a copy button.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  variant = "primary",
  confirm,
}: {
  action: Action;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const [copied, setCopied] = useState(false);
  const btn =
    variant === "danger"
      ? "inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      : variant === "secondary"
        ? "btn-secondary"
        : "btn-primary";
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btn} disabled={pending}>
          {pending ? "Working…" : submitLabel}
        </button>
        {state.error ? (
          <span role="alert" className="text-xs text-red-600">
            {state.error}
          </span>
        ) : null}
        {state.ok && state.message ? <span className="text-xs text-emerald-600">{state.message}</span> : null}
      </div>
      {state.ok && state.secret ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">Copy this now — it will not be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{state.secret}</code>
            <button
              type="button"
              className="btn-secondary !px-2 !py-1 text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(state.secret ?? "");
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
