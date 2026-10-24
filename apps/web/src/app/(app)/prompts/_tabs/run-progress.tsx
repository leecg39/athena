"use client";
import { useTranslations } from "@/components/locale-provider";


import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Snapshot {
  state: string;
  done: number;
  total: number;
  failed: number;
}

/** Live progress for queued/running runs (polls /api/runs/:id every 2s until finished). */
export function RunProgressBar({ runId, initial }: { runId: string; initial: Snapshot }) {
  const tt = useTranslations();
  const [snap, setSnap] = useState(initial);
  const router = useRouter();
  const active = snap.state === "queued" || snap.state === "running";

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) return;
        const p = (await res.json()) as { state: string; succeeded: number; failed: number; total: number };
        if (stopped) return;
        setSnap({ state: p.state, done: p.succeeded + p.failed, total: p.total, failed: p.failed });
        if (p.state !== "queued" && p.state !== "running") router.refresh();
      } catch {
        /* transient network error: keep polling */
      }
    };
    const id = setInterval(tick, 2000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, runId, router]);

  const pct = snap.total ? Math.round((snap.done / snap.total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="h-1.5 w-28 rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-1.5 rounded-full ${snap.state === "failed" ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">
        {tt(snap.state)} · {snap.done}/{snap.total}
        {tt(snap.failed ? ` · ${snap.failed} failed` : "")}
      </span>
    </div>
  );
}
