import Link from "next/link";
import type { ReactNode } from "react";

export const STEPS = [
  { id: "website", label: "Website" },
  { id: "brand", label: "Brand profile" },
  { id: "competitors", label: "Competitors" },
  { id: "prompts", label: "Prompts" },
  { id: "audience", label: "Region & persona" },
  { id: "search-console", label: "Search Console" },
  { id: "schedule", label: "Monitoring" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function stepHref(websiteId: string, step: StepId): string {
  return step === "website" ? "/onboarding" : `/onboarding/${websiteId}/${step}`;
}

export function nextStep(step: StepId): StepId | null {
  const i = STEPS.findIndex((s) => s.id === step);
  return STEPS[i + 1]?.id ?? null;
}

export function OnboardingFrame({
  step,
  websiteId,
  reached = 0,
  title,
  subtitle,
  children,
}: {
  step: StepId;
  websiteId?: string;
  /** furthest step index the user may jump back to */
  reached?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">A</div>
          <span className="font-semibold">Athenum</span>
          <span className="ml-2 text-sm text-gray-400">Set up AI search tracking</span>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ol className="mb-8 flex flex-wrap items-center gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const canJump = websiteId && i <= Math.max(reached, current) && i !== current;
            const badge = (
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                  i < current ? "bg-brand-600 text-white" : i === current ? "border-2 border-brand-600 text-brand-600" : "bg-gray-100 text-gray-400"
                }`}
              >
                {i + 1}
              </span>
            );
            return (
              <li key={s.id} className="flex items-center gap-1.5" aria-current={i === current ? "step" : undefined}>
                {canJump ? (
                  <Link href={stepHref(websiteId, s.id)} className="flex items-center gap-1.5 hover:opacity-80">
                    {badge}
                    <span className="hidden text-xs text-gray-500 md:inline">{s.label}</span>
                  </Link>
                ) : (
                  <>
                    {badge}
                    <span className={`hidden text-xs md:inline ${i === current ? "font-medium text-gray-900" : "text-gray-400"}`}>{s.label}</span>
                  </>
                )}
                {i < STEPS.length - 1 ? <span className="mx-1 h-px w-4 bg-gray-200" aria-hidden /> : null}
              </li>
            );
          })}
        </ol>
        <div className="rounded-2xl border border-gray-100 p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SourceNote({ source, provider }: { source: string; provider?: string }) {
  if (source === "ai") return <p className="text-xs text-gray-400">Suggested by AI ({provider}). Review before saving.</p>;
  if (source === "template") return <p className="text-xs text-amber-700">AI suggestions are unavailable — these are starter templates based on your site’s own copy.</p>;
  if (source === "failed") return <p className="text-xs text-amber-700">AI suggestions could not be generated right now. Add your own below.</p>;
  return <p className="text-xs text-gray-400">AI suggestions are off (no LLM API key configured). Add your own below.</p>;
}
