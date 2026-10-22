import { OnboardingWizard } from "@/components/onboarding-wizard";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Add Website" };

export default async function OnboardingPage() {
  await requireUser("/onboarding");
  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">🏛</div>
          <span className="font-semibold">Athenum</span>
        </div>
      </div>
      <OnboardingWizard />
    </div>
  );
}
