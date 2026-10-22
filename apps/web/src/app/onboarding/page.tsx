import Link from "next/link";
import { db } from "@athena/db";
import { listWebsitesForUser } from "@athena/core/tenancy";
import { requireUser } from "@/lib/session";
import { ActionForm } from "@/components/action-form";
import { OnboardingFrame, STEPS } from "./_steps/frame";
import { startOnboarding } from "./actions";

export const metadata = { title: "Add website" };

export default async function OnboardingStart() {
  const user = await requireUser("/onboarding");
  const unfinished = (await listWebsitesForUser(db, user.id)).filter((w) => !w.onboardedAt);
  return (
    <OnboardingFrame step="website" title="Add your website" subtitle="We’ll read your homepage and robots.txt to prefill your brand profile and check AI crawler access.">
      {unfinished.length ? (
        <div className="mb-6 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
          Continue setting up:{" "}
          {unfinished.map((w, i) => (
            <span key={w.id}>
              {i ? ", " : ""}
              <Link className="font-medium underline" href={`/onboarding/${w.id}/${STEPS[Math.min(w.onboardingStep + 1, STEPS.length - 1)].id}`}>
                {w.name}
              </Link>
            </span>
          ))}
        </div>
      ) : null}
      <ActionForm action={startOnboarding} submitLabel="Analyze website" className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Website domain</span>
          <input name="domain" className="input" placeholder="yourcompany.com" required maxLength={253} autoFocus />
        </label>
      </ActionForm>
    </OnboardingFrame>
  );
}
