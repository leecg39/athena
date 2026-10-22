"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function AthChat() {
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "user", content: initial },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const started = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function sendHistory(history: { role: string; content: string }[]) {
    setStreaming(true);
    setMessages((m) => [...history as never, { role: "assistant", content: "" }] as never);
    try {
      const res = await fetch("/api/athena/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initial) void sendHistory([{ role: "user", content: initial }]);
  }, [initial]);

  const send = () => {
    if (!input.trim() || streaming) return;
    const history = [...messages, { role: "user", content: input.trim() }];
    setMessages(history as never);
    setInput("");
    void sendHistory(history);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="flex h-screen flex-col bg-white">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-xl rounded-2xl bg-brand-600 px-4 py-2.5 text-sm text-white">
                {m.content}
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs text-white">🏛</div>
                <div className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                  {m.content || <span className="animate-pulse text-gray-400">Athena is thinking…</span>}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
      <div className="border-t border-gray-100 p-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            className="input flex-1"
            placeholder="Ask a follow-up…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn-primary !p-2" onClick={send} disabled={streaming}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
