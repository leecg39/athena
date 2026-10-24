export type Locale = "ko" | "en";
export const LOCALE_COOKIE = "athenum-locale";
export const DEFAULT_LOCALE: Locale = "ko";
export function resolveLocale(value?: string | null): Locale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}
