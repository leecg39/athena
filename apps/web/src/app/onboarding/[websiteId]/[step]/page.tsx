import { getTranslations } from "@/lib/i18n/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@athena/db";
import { getWebsiteForUser } from "@athena/core/tenancy";
import { requireUser } from "@/lib/session";
import { OnboardingFrame, STEPS, type StepId } from "../../_steps/frame";
import { BrandStep } from "../../_steps/brand";
import { CompetitorsStep } from "../../_steps/competitors";
import { PromptsStep } from "../../_steps/prompts";
import { AudienceStep } from "../../_steps/audience";
import { SearchConsoleStep } from "../../_steps/search-console";
import { ScheduleStep } from "../../_steps/schedule";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Set up tracking") };
}

const COPY: Record<Exclude<StepId, "website">, { title: string; subtitle: string }> = {
  brand: { title: "Confirm your brand profile", subtitle: "Used to detect mentions of your brand in AI answers." },
  competitors: { title: "Who do you compete with?", subtitle: "We measure share of voice against these brands." },
  prompts: { title: "Choose prompts to track", subtitle: "Questions buyers ask AI assistants in your category." },
  audience: { title: "Region and personas", subtitle: "Where and for whom AI answers should be sampled." },
  "search-console": { title: "Connect Google Search Console", subtitle: "Optional — enriches prompt discovery with real search queries." },
  schedule: { title: "Monitoring schedule", subtitle: "How often answers are collected. You can change this anytime." },
};

async function Loading() {
  const tt = await getTranslations();
  return <p className="text-sm text-gray-400">{tt("Preparing suggestions…")}</p>;
}

export default async function StepPage({
  params,
  searchParams,
}: {
  params: Promise<{ websiteId: string; step: string }>;
  searchParams: Promise<{ gsc?: string }>;
}) {
  const tt = await getTranslations();
  const { websiteId, step } = await params;
  const user = await requireUser(`/onboarding/${websiteId}/${step}`);
  const site = await getWebsiteForUser(db, user.id, websiteId);
  if (!site || !STEPS.some((s) => s.id === step) || step === "website") notFound();
  const id = step as Exclude<StepId, "website">;
  const { gsc } = await searchParams;
  const body = {
    brand: <BrandStep site={site} />,
    competitors: <CompetitorsStep site={site} />,
    prompts: <PromptsStep site={site} />,
    audience: <AudienceStep site={site} />,
    "search-console": <SearchConsoleStep site={site} result={gsc} />,
    schedule: <ScheduleStep site={site} />,
  }[id];
  return (
    <OnboardingFrame step={id} websiteId={site.id} reached={site.onboardingStep + 1} title={tt(COPY[id].title)} subtitle={tt(COPY[id].subtitle)}>
      <Suspense fallback={<Loading />}>{body}</Suspense>
    </OnboardingFrame>
  );
}
