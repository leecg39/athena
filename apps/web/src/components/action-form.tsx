"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action with inline success/error feedback.
 * One-time secrets (API keys, invite links) are shown with a copy button.
 * Field values are preserved when the action reports an error.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  variant = "primary",
  confirm,
  resetOnSuccess = false,
}: {
  action: Action;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
  /** clear the fields after a successful submit (for "add" forms) */
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);
  const [copied, setCopied] = useState(false);
  const btn =
    variant === "danger"
      ? "inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      : variant === "secondary"
        ? "btn-secondary"
        : "btn-primary";
  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(e) => {
        // Submit via a transition instead of the `action` prop: React resets
        // uncontrolled fields after an action completes, which would wipe the
        // user's input whenever the server returns a validation error.
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        if (submitter instanceof HTMLButtonElement && submitter.name) fd.set(submitter.name, submitter.value);
        startTransition(() => formAction(fd));
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
