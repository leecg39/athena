"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const QUICK_PROMPTS = [
  "How is my brand performing?",
  "Compare my competitors",
  "Which sources cite me the most?",
  "What content should I create?",
];

/** Ask Athena chat homepage — greeting + composer + quick chips (observed pattern). */
export function AthAskHome(props: { firstName: string; websiteName: string }) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [files, setFiles] = useState<{ name: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Up late";
    if (h < 12) return "Morning";
    if (h < 18) return "Afternoon";
    return "Evening";
  })();

  const send = (message?: string) => {
    const q = message ?? text;
    if (!q.trim()) return;
    const params = new URLSearchParams({ q });
    router.push(`/chat?${params.toString()}`);
  };

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-6">
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
          className={`mt-8 rounded-2xl border bg-white/90 p-4 shadow-lg backdrop-blur transition ${
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
            setFiles((f) => [...f, ...Array.from(e.dataTransfer.files).map((f) => ({ name: f.name }))]);
            setInteracting(true);
          }}
        >
          <textarea
            value={text}
            rows={3}
            placeholder="Ask Athena…"
            className="w-full resize-none bg-transparent text-sm outline-none"
            onChange={(e) => {
              setText(e.target.value);
              setInteracting(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50" onClick={() => fileRef.current?.click()} title="Attach files and images">
                +
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  setFiles((f) => [...f, ...Array.from(e.target.files ?? []).map((f) => ({ name: f.name }))]);
                  setInteracting(true);
                }}
              />
              <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50" title="Voice dictation">
                🎙
              </button>
              {files.map((f) => (
                <span key={f.name} className="badge bg-brand-50 text-brand-600">
                  {f.name}{" "}
                  <button onClick={() => setFiles((all) => all.filter((x) => x.name !== f.name))} className="ml-1 text-gray-400 hover:text-gray-600">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button className="btn-primary !p-2" onClick={() => send()} disabled={!text.trim()}>
              ↑
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="rounded-full border border-gray-200 bg-white/80 px-4 py-1.5 text-sm text-gray-600 shadow-sm transition hover:border-brand-600 hover:text-brand-600"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
