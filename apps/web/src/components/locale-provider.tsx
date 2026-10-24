"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTranslator, DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);
export function useLocale() { return useContext(LocaleContext); }
export function useTranslations() {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  function changeLocale(next: Locale) {
    if (locale === next || pending) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    if (!document.cookie.split("; ").includes(`${LOCALE_COOKIE}=${next}`)) {
      setError(true);
      return;
    }
    setError(false);
    startTransition(() => router.refresh());
  }
  return (
    <LocaleContext.Provider value={locale}>
      <div className="language-bar">
        {error && <span role="alert" className="text-xs text-red-600">{locale === "ko" ? "언어 설정을 저장하려면 쿠키를 허용해 주세요." : "Allow cookies to save your language preference."}</span>}
        <div role="group" aria-label={locale === "ko" ? "표시 언어" : "Display language"} aria-busy={pending} className="inline-flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          {(["en", "ko"] as const).map((option) => (
            <button key={option} type="button" lang={option} aria-label={option === "ko" ? "한국어" : "English"} aria-pressed={locale === option} disabled={pending} onClick={() => changeLocale(option)} className={`rounded-md px-3 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60 ${locale === option ? "bg-brand-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {children}
    </LocaleContext.Provider>
  );
}
