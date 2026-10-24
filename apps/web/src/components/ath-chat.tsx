"use client";
import { useTranslations } from "@/components/locale-provider";


import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ConnectorState } from "@/lib/assistant";
import type { ActionState } from "@/lib/action-state";
import { deleteThreadAction, renameThreadAction } from "@/app/chat/actions";
import { ACCEPT_ATTR, MAX_MESSAGE_CHARS, readBrowserFiles, type DraftAttachment } from "./ask/attachments";
import { ConnectorsBar } from "./ask/connectors-bar";
import { Markdown } from "./ask/markdown";

const idle: ActionState = { ok: false };

export interface ChatToolBadge {
  name: string;
  status: "running" | "done" | "error";
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: { name: string; type: string; size: number }[];
  toolCalls: ChatToolBadge[];
  provider: string | null;
  simulated: boolean;
  status: "complete" | "stopped" | "streaming";
}

export interface ChatThreadView {
  id: string;
  title: string;
  busy: boolean;
  messages: ChatMessageView[];
}

export interface ThreadSummaryItem {
  id: string;
  title: string;
  updatedAt: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_visibility_metrics: "Visibility metrics",
  compare_competitors: "Competitor comparison",
  search_answers: "Sampled AI answers",
  top_sources: "Cited sources",
  find_content_opportunities: "Content opportunities",
  search_console_queries: "Search Console queries",
};

const QUICK_PROMPTS = [
  "How is my brand performing?",
  "Compare my competitors",
  "Which sources cite me the most?",
  "What content should I create?",
];

function upsertTool(list: ChatToolBadge[], name: string, status: ChatToolBadge["status"]): ChatToolBadge[] {
  const idx = list.findIndex((t) => t.name === name && t.status === "running");
  if (idx !== -1 && status !== "running") {
    const next = [...list];
    next[idx] = { name, status };
    return next;
  }
  return [...list, { name, status }];
}

function ThreadHeaderControls({
  threadId,
  title,
  onRenamed,
}: {
  threadId: string;
  title: string;
  onRenamed: (next: string) => void;
}) {
  const tt = useTranslations();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [renameState, renameFormAction, renaming] = useActionState(renameThreadAction, idle);
  const [deleteState, deleteFormAction, deleting] = useActionState(deleteThreadAction, idle);
  const router = useRouter();

  useEffect(() => {
    setDraft(title);
  }, [title]);

  useEffect(() => {
    if (renameState.ok && editing) {
      setEditing(false);
      onRenamed(draft.trim());
      router.refresh();
    }
  }, [renameState, editing, draft, onRenamed, router]);

  useEffect(() => {
    if (deleteState.ok) {
      router.push("/chat");
      router.refresh();
    }
  }, [deleteState, router]);

  return (
    <div className="flex items-center gap-2">
      {editing ? (
        <form action={renameFormAction} className="flex items-center gap-1.5">
          <input type="hidden" name="threadId" value={threadId} />
          <input
            name="title"
            value={draft}
            maxLength={80}
            aria-label={tt("Chat title")}
            onChange={(e) => setDraft(e.target.value)}
            className="input !py-1 text-xs"
          />
          <button type="submit" disabled={renaming || !draft.trim()} className="btn-primary !px-2.5 !py-1 text-xs">
            {tt("Save")}</button>
          <button type="button" onClick={() => setEditing(false)} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500">
            {tt("Cancel")}</button>
        </form>
      ) : (
        <>
          <h1 className="truncate text-sm font-semibold text-gray-900">{tt(title)}</h1>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50"
          >
            {tt("Rename")}</button>
          <form
            action={deleteFormAction}
            onSubmit={(e) => {
              if (!window.confirm(tt("Delete this chat?"))) e.preventDefault();
            }}
          >
            <input type="hidden" name="threadId" value={threadId} />
            <button
              type="submit"
              disabled={deleting}
              className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
            >
              {tt("Delete")}</button>
          </form>
        </>
      )}
      {renameState.error ? <span className="text-xs text-red-600">{tt(renameState.error)}</span> : null}
      {deleteState.error ? <span className="text-xs text-red-600">{tt(deleteState.error)}</span> : null}
    </div>
  );
}

export function AthChat({
  websiteName,
  websiteDomain,
  connectors,
  threads,
  initialThread,
  initialQuery,
  initialSearchConsole,
  notFoundError,
}: {
  websiteName: string;
  websiteDomain: string;
  connectors: ConnectorState[];
  threads: ThreadSummaryItem[];
  initialThread: ChatThreadView | null;
  initialQuery?: string;
  initialSearchConsole: boolean;
  notFoundError?: string | null;
}) {
  const tt = useTranslations();
  const router = useRouter();
  const [threadId, setThreadId] = useState<string | null>(initialThread?.id ?? null);
  const [title, setTitle] = useState<string>(initialThread?.title ?? "New chat");
  const [messages, setMessages] = useState<ChatMessageView[]>(initialThread?.messages ?? []);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<DraftAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [searchConsole, setSearchConsole] = useState(initialSearchConsole);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(notFoundError ?? null);

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoRanForRef = useRef<string | null>(null);

  useEffect(() => {
    const nextId = initialThread?.id ?? null;
    setThreadId((prevId) => {
      if (prevId !== nextId) {
        setTitle(initialThread?.title ?? "New chat");
        setMessages(initialThread?.messages ?? []);
        setError(notFoundError ?? null);
      } else {
        if (initialThread) setTitle(initialThread.title);
        if (!nextId) setError(notFoundError ?? null);
      }
      return nextId;
    });
  }, [initialThread, notFoundError]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function streamAnswer(
    targetThreadId: string,
    followUp?: { message: string; attachments: DraftAttachment[] },
  ) {
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    setError(null);

    const placeholderId = `stream-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      ...(followUp
        ? [
            {
              id: `user-${Date.now()}`,
              role: "user" as const,
              content: followUp.message,
              attachments: followUp.attachments.map((a) => ({ name: a.name, type: "text/plain", size: a.size })),
              toolCalls: [],
              provider: null,
              simulated: false,
              status: "complete" as const,
            },
          ]
        : []),
      {
        id: placeholderId,
        role: "assistant" as const,
        content: "",
        attachments: [],
        toolCalls: [],
        provider: null,
        simulated: false,
        status: "streaming" as const,
      },
    ]);

    const patchAssistant = (fn: (m: ChatMessageView) => ChatMessageView) => {
      setMessages((prev) => prev.map((m) => (m.id === placeholderId ? fn(m) : m)));
    };

    try {
      const res = await fetch("/api/athena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          threadId: targetThreadId,
          ...(followUp
            ? {
                message: followUp.message,
                attachments: followUp.attachments.map(({ name, text }) => ({ name, text })),
              }
            : {}),
          searchConsole,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
        setError(body.error ?? "Athena could not answer right now.");
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let completed = false;
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const ev = JSON.parse(line) as Record<string, unknown>;
        if (ev.type === "provider") {
          patchAssistant((m) => ({
            ...m,
            provider: typeof ev.id === "string" ? ev.id : null,
            simulated: Boolean(ev.simulated),
          }));
        } else if (ev.type === "tool" && typeof ev.name === "string" && typeof ev.status === "string") {
          const st = ev.status === "done" || ev.status === "error" ? ev.status : "running";
          patchAssistant((m) => ({ ...m, toolCalls: upsertTool(m.toolCalls, ev.name as string, st) }));
        } else if (ev.type === "text" && typeof ev.delta === "string") {
          patchAssistant((m) => ({ ...m, content: m.content + (ev.delta as string) }));
        } else if (ev.type === "error" && typeof ev.message === "string") {
          setError(ev.message);
          setMessages((prev) => prev.filter((m) => m.id !== placeholderId || Boolean(m.content.trim())));
        } else if (ev.type === "done") {
          completed = true;
          patchAssistant((m) => ({ ...m, status: "complete" }));
        }
      };

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      }
      if (buffer.trim()) handleLine(buffer);
      if (completed) router.refresh();
    } catch (err) {
      if (ac.signal.aborted) {
        setMessages((prev) =>
          prev.flatMap((m) => {
            if (m.id !== placeholderId) return [m];
            return m.content.trim() ? [{ ...m, status: "stopped" as const }] : [];
          }),
        );
        router.refresh();
        return;
      }
      console.error("[chat] stream failed", err);
      setMessages((prev) => prev.filter((m) => m.id !== placeholderId || Boolean(m.content.trim())));
      setError("Connection interrupted while Athena was answering.");
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  useEffect(() => {
    if (initialThread && !initialThread.busy && initialThread.messages.at(-1)?.role === "user") {
      if (autoRanForRef.current !== initialThread.id) {
        autoRanForRef.current = initialThread.id;
        void streamAnswer(initialThread.id);
      }
      return;
    }
    if (!initialThread && initialQuery?.trim() && autoRanForRef.current !== `q:${initialQuery}`) {
      autoRanForRef.current = `q:${initialQuery}`;
      void startNewThread(initialQuery.trim(), []);
    }
  }, [initialThread, initialQuery]);

  async function startNewThread(q: string, draftFiles: DraftAttachment[]) {
    setStreaming(true);
    setError(null);
    try {
      const res = await fetch("/api/athena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          attachments: draftFiles.map(({ name, text }) => ({ name, text })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { threadId?: string; thread?: { title?: string }; error?: string };
      if (!res.ok || !data.threadId) {
        setError(data.error ?? "Could not start the chat.");
        setStreaming(false);
        return;
      }
      const newId = data.threadId;
      autoRanForRef.current = newId;
      setThreadId(newId);
      setTitle(data.thread?.title ?? q.slice(0, 80));
      setMessages([
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: q,
          attachments: draftFiles.map((a) => ({ name: a.name, type: "text/plain", size: a.size })),
          toolCalls: [],
          provider: null,
          simulated: false,
          status: "complete",
        },
      ]);
      router.replace(`/chat?id=${encodeURIComponent(newId)}${!searchConsole ? "&gsc=0" : ""}`);
      await streamAnswer(newId);
    } catch {
      setError("Network error while starting the chat.");
      setStreaming(false);
    }
  }

  async function addFiles(incoming: FileList | File[]) {
    const res = await readBrowserFiles(files, incoming);
    setFiles(res.attachments);
    setError(res.error);
  }

  async function send(overrideMessage?: string) {
    const q = (overrideMessage ?? input).trim();
    if (!q || streaming) return;
    const attached = files;
    setInput("");
    setFiles([]);
    if (!threadId) {
      await startNewThread(q, attached);
    } else {
      await streamAnswer(threadId, { message: q, attachments: attached });
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  const canRetry = !streaming && Boolean(threadId) && messages.at(-1)?.role === "user";

  return (
    <div className="flex h-screen bg-white">
      {/* Left sidebar: thread list & navigation */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-gray-100 bg-gray-50/70">
        <div className="flex items-center justify-between border-b border-gray-100 p-3">
          <Link href="/home" className="text-xs font-medium text-gray-600 hover:text-brand-600">
            {tt("← Back to Home")}</Link>
          <Link
            href="/chat"
            onClick={() => {
              abortRef.current?.abort();
              setThreadId(null);
              setTitle("New chat");
              setMessages([]);
              setError(null);
            }}
            className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
          >
            {tt("+ New chat")}</Link>
        </div>

        <div className="px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {tt("Chats · ")}{websiteName}
        </div>
        <nav aria-label={tt("Chat history")} className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {threads.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-400">{tt("No saved chats yet.")}</p>
          ) : (
            threads.map((t) => {
              const active = t.id === threadId;
              return (
                <Link
                  key={t.id}
                  href={`/chat?id=${encodeURIComponent(t.id)}${!searchConsole ? "&gsc=0" : ""}`}
                  className={`block truncate rounded-lg px-2.5 py-2 text-xs transition ${
                    active ? "bg-brand-50 font-semibold text-brand-600" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {t.title}
                </Link>
              );
            })
          )}
        </nav>
      </aside>

      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-3">
          <div className="min-w-0">
            {threadId ? (
              <ThreadHeaderControls threadId={threadId} title={tt(title)} onRenamed={setTitle} />
            ) : (
              <h1 className="text-sm font-semibold text-gray-900">{tt("Ask Athena")}</h1>
            )}
            <p className="text-xs text-gray-400">
              {tt("Grounded in ")}<span className="font-medium text-gray-600">{websiteName}</span> ({websiteDomain})
            </p>
          </div>
          <ConnectorsBar
            connectors={connectors}
            searchConsole={searchConsole}
            onToggleSearchConsole={setSearchConsole}
          />
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-6 text-center">
                <h2 className="text-base font-semibold text-gray-900">{tt("Ask Athena anything about ")}{websiteName}</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {tt("Athena queries your visibility metrics, competitor benchmarks, cited sources and sampled AI answers.")}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={streaming}
                      onClick={() => void send(q)}
                      className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs text-gray-700 shadow-sm hover:border-brand-600 hover:text-brand-600"
                    >
                      {tt(q)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="ml-auto max-w-xl space-y-1.5">
                  <div className="rounded-2xl bg-brand-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
                    {m.content}
                  </div>
                  {m.attachments.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.attachments.map((a) => (
                        <span key={a.name} className="badge bg-brand-50 text-brand-600">
                          📎 {a.name} ({a.size.toLocaleString()} {tt(" chars)")}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs text-white">
                    🏛
                  </div>
                  <div className="min-w-0 max-w-2xl flex-1 space-y-2">
                    {m.toolCalls.length > 0 || m.provider || m.status === "stopped" ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {m.toolCalls.map((tc, idx) => (
                          <span
                            key={`${tc.name}-${idx}`}
                            className={`rounded-full px-2.5 py-0.5 font-medium ${
                              tc.status === "running"
                                ? "animate-pulse bg-amber-50 text-amber-700"
                                : tc.status === "error"
                                  ? "bg-red-50 text-red-700"
                                  : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {tt(tc.status === "running" ? "⟳ " : tc.status === "error" ? "! " : "✓ ")}
                            {TOOL_LABELS[tc.name] ?? tc.name}
                          </span>
                        ))}
                        {m.simulated ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                            {tt("Simulated")}</span>
                        ) : m.provider ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">{m.provider}</span>
                        ) : null}
                        {m.status === "stopped" ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">{tt("Stopped")}</span>
                        ) : null}
                      </div>
                    ) : null}

                    {m.content ? (
                      <Markdown text={m.content} />
                    ) : (
                      <p className="animate-pulse text-sm text-gray-400">{tt("Athena is analysing your workspace data…")}</p>
                    )}
                  </div>
                </div>
              ),
            )}

            {error ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {tt(error)}
              </div>
            ) : null}

            {canRetry ? (
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={() => threadId && void streamAnswer(threadId)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {tt("↻ Generate answer")}</button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Composer */}
        <div
          className={`border-t p-4 transition ${
            dragging ? "border-brand-600 bg-brand-50/30" : "border-gray-100 bg-white"
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
          <div className="mx-auto max-w-3xl space-y-2">
            {files.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <span key={f.name} className="badge bg-brand-50 text-brand-600">
                    {f.name} <span className="text-[10px] text-gray-400">({f.size.toLocaleString()} {tt(" chars)")}</span>
                    <button
                      type="button"
                      aria-label={tt("Remove {0}", { 0: f.name })}
                      onClick={() => setFiles((all) => all.filter((x) => x.name !== f.name))}
                      className="ml-1 text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
                title={tt("Attach text files (TXT, MD, CSV, TSV, JSON)")}
              >
                {tt("+ File")}</button>
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
              <textarea
                rows={2}
                maxLength={MAX_MESSAGE_CHARS}
                className="input flex-1 resize-none"
                placeholder={tt("Ask a follow-up or drop a TXT/MD/CSV/JSON file…")}
                value={input}
                disabled={streaming}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {tt("Stop")}</button>
              ) : (
                <button
                  type="button"
                  aria-label={tt("Send message")}
                  className="btn-primary !px-3.5 !py-2"
                  onClick={() => void send()}
                  disabled={!input.trim()}
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
