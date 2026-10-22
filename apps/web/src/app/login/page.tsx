"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const doEmail = async () => {
    if (!email) return;
    setBusy(true);
    try {
      // Dev login (AUTH_DEV_LOGIN=true) uses the credentials provider;
      // with RESEND configured this is the magic-link provider.
      await signIn(
        process.env.NEXT_PUBLIC_DEV_LOGIN === "true" ? "credentials" : "resend",
        { email, callbackUrl: "/home" },
      );
    } finally {
      setBusy(false);
    }
  };

  const hasGoogle = process.env.NEXT_PUBLIC_DEV_HAS_GOOGLE === "true";
  const hasMicrosoft = process.env.NEXT_PUBLIC_DEV_HAS_MICROSOFT === "true";

  return (
    <div className="flex min-h-screen">
      {/* Left: sign-in card */}
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-[55%]">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-2xl text-white">
              🏛
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">Sign in to Athenum</h1>
            <p className="text-sm text-gray-500">Use your company email address</p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => signIn("google", { callbackUrl: "/home" })}
              className="btn-primary w-full !py-2.5"
              disabled={!hasGoogle}
            >
              <span className="font-bold">G</span> Continue with Google
            </button>
            <button
              onClick={() => signIn("microsoft", { callbackUrl: "/home" })}
              className="btn-secondary w-full !py-2.5"
              disabled={!hasMicrosoft}
            >
              <span className="text-[10px] leading-none">▦</span> Continue with Microsoft
            </button>

            <div className="relative py-2 text-center">
              <span className="relative z-10 bg-white px-2 text-xs text-gray-400">or</span>
              <span className="absolute left-0 top-1/2 h-px w-full bg-gray-100" />
            </div>

            {emailMode ? (
              <div className="flex flex-col gap-2">
                <input
                  type="email"
                  placeholder="you@company.com"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doEmail()}
                />
                <button className="btn-primary w-full !py-2.5" onClick={doEmail} disabled={busy}>
                  ✉ {busy ? "Signing in…" : "Continue with email"}
                </button>
              </div>
            ) : (
              <button className="btn-secondary w-full !py-2.5" onClick={() => setEmailMode(true)}>
                ✉ Continue with email
              </button>
            )}
          </div>

          <p className="mt-8 text-center text-xs text-gray-400">
            By signing in, you agree to our{" "}
            <a href="#" className="underline">terms of service</a> and{" "}
            <a href="#" className="underline">privacy policy</a>.
          </p>
        </div>
      </div>

      {/* Right: rotating testimonial on gradient (observed pattern) */}
      <div className="hidden flex-1 items-center justify-center bg-gradient-to-b from-brand-light via-brand-600 to-[#2a1a8f] p-10 lg:flex">
        <div className="max-w-md rounded-2xl bg-white/95 p-8 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg text-brand-600">A</div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Acme Growth Co.</div>
              <div className="text-xs text-gray-500">Head of AI Search</div>
            </div>
          </div>
          <p className="text-lg font-medium leading-relaxed text-gray-800">
            “We&apos;ve seen a 10x increase in AI-referred traffic in six months — and the visitors
            convert better than anything else in the funnel.”
          </p>
        </div>
      </div>
    </div>
  );
}
