import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn, providerInfo } from "@/lib/auth";
import { safeRedirect } from "@/lib/auth.config";

export const metadata = { title: "Sign in" };

const ERROR_TEXT: Record<string, string> = {
  CredentialsSignin: "That sign-in attempt was rejected. Check the email address and try again.",
  Verification: "The sign-in link is invalid or has expired.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirect(params.redirect ?? params.callbackUrl);
  if ((await auth())?.user?.id) redirect(redirectTo);

  const error = typeof params.error === "string" ? params.error : null;
  const oauth = providerInfo.filter((p) => p.id === "google" || p.id === "microsoft-entra-id");
  const hasEmail = providerInfo.some((p) => p.id === "resend");
  const hasDev = providerInfo.some((p) => p.id === "dev");

  async function run(provider: string, options: Record<string, string>) {
    "use server";
    try {
      await signIn(provider, { ...options, redirectTo });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/login?error=${encodeURIComponent(err.type)}&redirect=${encodeURIComponent(redirectTo)}`);
      }
      throw err; // NEXT_REDIRECT and unexpected errors propagate
    }
  }
  async function oauthAction(formData: FormData) {
    "use server";
    const id = String(formData.get("provider"));
    if (id !== "google" && id !== "microsoft-entra-id") redirect("/login?error=Configuration");
    await run(id, {});
  }
  async function emailAction(formData: FormData) {
    "use server";
    await run("resend", { email: String(formData.get("email") ?? "") });
  }
  async function devAction(formData: FormData) {
    "use server";
    await run("dev", { email: String(formData.get("email") ?? "") });
  }

  return (
    <div className="flex min-h-screen bg-white">
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-[55%]">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">A</div>
            <h1 className="text-2xl font-semibold text-gray-900">Sign in to Athenum</h1>
            <p className="text-sm text-gray-500">Use your company email address</p>
          </div>

          {error ? (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {ERROR_TEXT[error] ?? `Sign-in failed (${error}). Please try again.`}
            </p>
          ) : null}

          <div className="flex flex-col gap-3">
            {oauth.map((p) => (
              <form key={p.id} action={oauthAction}>
                <input type="hidden" name="provider" value={p.id} />
                <button type="submit" className="btn-secondary w-full !py-2.5">
                  {p.label}
                </button>
              </form>
            ))}

            {hasEmail ? (
              <form action={emailAction} className="flex flex-col gap-2">
                {oauth.length ? <Divider /> : null}
                <label htmlFor="email" className="sr-only">Work email</label>
                <input id="email" name="email" type="email" required placeholder="you@company.com" className="input" />
                <button type="submit" className="btn-primary w-full !py-2.5">Continue with email</button>
              </form>
            ) : null}

            {hasDev ? (
              <form action={devAction} className="mt-2 flex flex-col gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3">
                <label htmlFor="dev-email" className="text-xs font-medium text-amber-800">
                  Developer login (local only — AUTH_DEV_LOGIN)
                </label>
                <input id="dev-email" name="email" type="email" required defaultValue="demo@example.com" className="input" />
                <button type="submit" className="btn-secondary w-full">Sign in as developer</button>
              </form>
            ) : null}

            {providerInfo.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                No sign-in method is configured. Set Google, Microsoft or Resend credentials — or
                AUTH_DEV_LOGIN=true for local development.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="hidden flex-1 items-center justify-center bg-gradient-to-b from-brand-light via-brand-600 to-[#2a1a8f] p-10 lg:flex">
        <div className="max-w-md text-white">
          <p className="text-sm font-medium uppercase tracking-widest text-white/70">AI search visibility</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight">See how ChatGPT, Perplexity and Gemini talk about your brand.</h2>
          <ul className="mt-6 space-y-2 text-sm text-white/85">
            <li>Mention rate, citation rate and share of voice across AI models</li>
            <li>The sources AI answers cite — and where competitors win</li>
            <li>Content and outreach actions to close the gaps</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div className="relative py-2 text-center">
      <span className="relative z-10 bg-white px-2 text-xs text-gray-400">or</span>
      <span className="absolute left-0 top-1/2 h-px w-full bg-gray-100" />
    </div>
  );
}
