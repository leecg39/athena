"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ConnectorState } from "@/lib/assistant";
import { ACCEPT_ATTR, MAX_MESSAGE_CHARS, readBrowserFiles, type DraftAttachment } from "./ask/attachments";
import { ConnectorsBar } from "./ask/connectors-bar";

const QUICK_PROMPTS = [
  "How is my brand performing?",
  "Compare my competitors",
  "Which sources cite me the most?",
  "What content should I create?",
];

export interface RecentThreadItem {
  id: string;
  title: string;
  updatedAt: string;
}

/** Ask Athena chat homepage — greeting + composer + quick chips + connector context. */
export function AthAskHome(props: {
  firstName: string;
  websiteName: string;
  connectors: ConnectorState[];
  recentThreads?: RecentThreadItem[];
}) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [files, setFiles] = useState<DraftAttachment[]>([]);
  const [searchConsole, setSearchConsole] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Up late";
    if (h < 12) return "Morning";
    if (h < 18) return "Afternoon";
    return "Evening";
  })();

  async function addFiles(incoming: FileList | File[]) {
    setInteracting(true);
    const res = await readBrowserFiles(files, incoming);
    setFiles(res.attachments);
    setError(res.error);
  }

  async function send(overrideMessage?: string) {
    const q = (overrideMessage ?? text).trim();
    if (!q || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/athena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          attachments: files.map(({ name, text: body }) => ({ name, text: body })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { threadId?: string; error?: string };
      if (!res.ok || !data.threadId) {
        setError(data.error ?? "Could not start the chat. Please try again.");
        setSubmitting(false);
        return;
      }
      const params = new URLSearchParams({ id: data.threadId });
      if (!searchConsole) params.set("gsc", "0");
      router.push(`/chat?${params.toString()}`);
    } catch {
      setError("Network error while starting the chat. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-6 py-12">
      {/* atmosphere background, pauses on interaction */}
      <div className={`aura pointer-events-none absolute inset-0 ${interacting ? "paused" : ""}`} />

      <div className="relative z-10 w-full max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
          {greeting}, {props.firstName}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Asking about <span className="font-medium text-gray-700">{props.websiteName}</span>
        </p>

        <div
          className={`mt-8 rounded-2xl border bg-white/90 p-4 text-left shadow-lg backdrop-blur transition ${
            dragging ? "border-brand-600 ring-4 ring-brand-100" : "border-gray-200"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
          }}
        >
          <textarea
            value={text}
            rows={3}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Ask Athena about your AI visibility, competitors, sources or content…"
            className="w-full resize-none bg-transparent text-sm outline-none"
            disabled={submitting}
            onChange={(e) => {
              setText(e.target.value);
              setInteracting(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />

          {files.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f) => (
                <span key={f.name} className="badge bg-brand-50 text-brand-600">
                  {f.name} <span className="text-[10px] text-gray-400">({f.size.toLocaleString()} chars)</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((all) => all.filter((x) => x.name !== f.name))}
                    className="ml-1 text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                onClick={() => fileRef.current?.click()}
                title="Attach text files (TXT, MD, CSV, TSV, JSON)"
              >
                + Attach file
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <ConnectorsBar
                connectors={props.connectors}
                searchConsole={searchConsole}
                onToggleSearchConsole={setSearchConsole}
              />
            </div>
            <button
              type="button"
              aria-label="Send question"
              className="btn-primary !px-3 !py-1.5"
              onClick={() => void send()}
              disabled={!text.trim() || submitting}
            >
              {submitting ? "…" : "↑"}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={submitting}
              onClick={() => void send(q)}
              className="rounded-full border border-gray-200 bg-white/80 px-4 py-1.5 text-sm text-gray-600 shadow-sm transition hover:border-brand-600 hover:text-brand-600 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {props.recentThreads && props.recentThreads.length > 0 ? (
          <div className="mt-10 rounded-2xl border border-gray-100 bg-white/80 p-4 text-left shadow-sm backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-400">
              <span>Recent chats</span>
              <Link href="/chat" className="font-medium normal-case text-brand-600 hover:underline">
                Open full chat →
              </Link>
            </div>
            <ul className="divide-y divide-gray-100 text-sm">
              {props.recentThreads.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/chat?id=${encodeURIComponent(t.id)}`}
                    className="flex items-center justify-between py-2 text-gray-700 hover:text-brand-600"
                  >
                    <span className="truncate font-medium">{t.title}</span>
                    <span className="ml-3 shrink-0 text-xs text-gray-400">{t.updatedAt.slice(0, 10)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
