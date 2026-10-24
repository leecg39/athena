import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";

export async function generateMetadata() {
  const tt = await getTranslations();
  return {
  title: tt("Athenum — AI Search Visibility & Answer Engine Optimization Platform"),
};
}

const MODEL_ENGINES = [
  "ChatGPT Search",
  "Perplexity",
  "Claude",
  "Google AI Overviews",
  "Google AI Mode",
  "Gemini",
  "Microsoft Copilot",
  "Grok",
];

const PLATFORM_PILLARS = [
  {
    badge: "Olympus Analytics",
    title: "Real-Time Share of Voice Across 8 Answer Engines",
    description:
      "Track daily brand mentions, citation rates, average ranking position, and estimated AI traffic value across every persona, region, and topic.",
  },
  {
    badge: "Oracle & Knowledge Base",
    title: "Detect & Eliminate AI Hallucinations",
    description:
      "Continuously audit LLM responses against your canonical Knowledge Base facts and resolve brand inaccuracies before buyers see them.",
  },
  {
    badge: "Content Hub & Outreach",
    title: "Ship Citation-Engineered AEO Content & CMS Sync",
    description:
      "Generate prompt-grounded briefs, full articles, and Shopify catalog optimizations with 1-click publishing to Webflow, WordPress, Contentful, and Sanity.",
  },
];

export default async function LandingPage() {
  const tt = await getTranslations();
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold">
            {tt("A")}</div>
          <span className="text-lg font-semibold tracking-tight">{tt("Athenum")}</span>
        </div>
        <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
          <a href="#platform" className="hover:text-white">
            {tt("Platform")}</a>
          <a href="#pricing" className="hover:text-white">
            {tt("Pricing")}</a>
          <Link href="/bot" className="hover:text-white">
            {tt("Crawler Docs")}</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-900"
          >
            {tt("Sign in")}</Link>
          <Link
            href="/home"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {tt("Open Workspace →")}</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">
            {tt("Enterprise Generative Engine Optimization (GEO & AEO)")}</span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            {tt("Command Your Brand's Presence Across AI Search")}</h1>
          <p className="mt-4 text-base text-slate-300 sm:text-lg">
            {tt("Athenum monitors how ChatGPT, Perplexity, Claude, Gemini, and Google AI Overviews cite your brand—and deploys autonomous content and outreach workflows to win Share of Voice.")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/home"
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              {tt("Launch Live Dashboard")}</Link>
            <Link
              href="/settings/observability"
              className="rounded-xl border border-slate-700 bg-slate-900 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              {tt("Observability & Status")}</Link>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
          {MODEL_ENGINES.map((engine) => (
            <span
              key={engine}
              className="rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-300"
            >
              {engine}
            </span>
          ))}
        </div>

        <section id="platform" className="mt-16 grid gap-6 md:grid-cols-3">
          {PLATFORM_PILLARS.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                {tt(p.badge)}
              </span>
              <h2 className="mt-2 text-lg font-semibold text-white">{tt(p.title)}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{tt(p.description)}</p>
            </div>
          ))}
        </section>

        <section id="pricing" className="mt-16 rounded-2xl border border-slate-800 bg-slate-900/50 p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">{tt("Transparent Credit-Based Plans")}</h2>
              <p className="mt-1 text-sm text-slate-400">
                {tt("Free Trial (300 credits) · Starter ($295/mo, 3,600 credits) · Enterprise ($1,450/mo, 25,000 credits + SAML SSO)")}</p>
            </div>
            <Link
              href="/settings/billing"
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100"
            >
              {tt("View Plans & Credit Pools")}</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
