"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = ["Brand profile", "Competitors", "Prompts", "Region & persona", "Search Console", "Monitoring"] as const;

/** Multi-step onboarding wizard (observed: brand profile → competitors → prompts → region → GSC → schedule). */
export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [site, setSite] = useState("");
  const [brand, setBrand] = useState<{ name: string; description: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [country, setCountry] = useState("US");
  const [persona, setPersona] = useState("");
  const [gsc, setGsc] = useState(false);
  const [cadence, setCadence] = useState("daily");
  const router = useRouter();

  const probeSite = async () => {
    if (!site) return;
    setProbing(true);
    try {
      const res = await fetch(`/api/onboarding/probe?site=${encodeURIComponent(site)}`);
      const data = (await res.json()) as { name: string; description?: string; suggestedCompetitors: string[]; suggestedPrompts: string[] };
      setBrand({ name: data.name, description: data.description ?? "" });
      setCompetitors(data.suggestedCompetitors);
      setPrompts(data.suggestedPrompts);
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                i < step ? "bg-brand-600 text-white" : i === step ? "border-2 border-brand-600 text-brand-600" : "bg-gray-100 text-gray-400"
              }`}
            >
              {i + 1}
            </div>
            <span className={`hidden text-xs md:block ${i === step ? "font-medium text-gray-900" : "text-gray-400"}`}>{s}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-100 p-6 shadow-sm">
        {step === 0 ? (
          <>
            <h2 className="text-lg font-semibold">Add your website</h2>
            <p className="mb-4 text-sm text-gray-500">We&apos;ll crawl it and prefill your brand profile.</p>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="yourcompany.com" value={site} onChange={(e) => setSite(e.target.value)} />
              <button className="btn-primary" onClick={probeSite} disabled={probing}>
                {probing ? "Crawling…" : "Analyze"}
              </button>
            </div>
            {brand ? (
              <div className="mt-4 space-y-3 rounded-lg bg-gray-50 p-4 text-sm">
                <div>
                  <span className="text-xs text-gray-400">Brand name</span>
                  <input className="input mt-1" defaultValue={brand.name} />
                </div>
                <div>
                  <span className="text-xs text-gray-400">Description</span>
                  <textarea className="input mt-1" rows={2} defaultValue={brand.description} />
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2 className="text-lg font-semibold">Competitors</h2>
            <p className="mb-4 text-sm text-gray-500">Track brands you compete with in AI answers.</p>
            <div className="flex flex-wrap gap-2">
              {competitors.map((c) => (
                <button
                  key={c}
                  onClick={() => setCompetitors((all) => (all.includes(c) ? all.filter((x) => x !== c) : [...all, c]))}
                  className={`badge ${competitors.includes(c) ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-lg font-semibold">Prompts to track</h2>
            <p className="mb-4 text-sm text-gray-500">Start with the suggested prompts — you can add more later.</p>
            <div className="space-y-2">
              {prompts.map((p) => (
                <label key={p} className="flex items-center gap-2 rounded-lg border border-gray-100 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={prompts.includes(p)}
                    onChange={() => setPrompts((all) => (all.includes(p) ? all.filter((x) => x !== p) : [...all, p]))}
                  />
                  {p}
                </label>
              ))}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="text-lg font-semibold">Region & persona</h2>
            <p className="mb-4 text-sm text-gray-500">Country-level tracking and the buyer persona prompts target.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-gray-500">Country</span>
                <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {["US", "KR", "GB", "DE", "JP", "CA", "AU"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-gray-500">Persona</span>
                <input className="input" placeholder="e.g. Growth marketer" value={persona} onChange={(e) => setPersona(e.target.value)} />
              </label>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h2 className="text-lg font-semibold">Google Search Console</h2>
            <p className="mb-4 text-sm text-gray-500">Use real search queries as tracked prompts and compare organic vs AI performance.</p>
            <button className="btn-secondary" onClick={() => setGsc(true)} disabled={gsc}>
              {gsc ? "Connected ✓" : "Connect Google Search Console"}
            </button>
            <p className="mt-2 text-xs text-gray-400">Skip for now — you can connect later in Settings → Integrations.</p>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <h2 className="text-lg font-semibold">Monitoring schedule</h2>
            <p className="mb-4 text-sm text-gray-500">How often we sample AI answers for your prompts.</p>
            <div className="flex gap-2">
              {["daily", "every 6 hours", "weekly"].map((c) => (
                <button key={c} className={`badge ${cadence === c ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600"}`} onClick={() => setCadence(c)}>
                  {c}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-6 flex justify-between">
        <button className="btn-secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
            Continue →
          </button>
        ) : (
          <button className="btn-primary" onClick={() => router.push("/home")}>
            Finish setup
          </button>
        )}
      </div>
    </div>
  );
}
