import ko from "./ko.json";

import type { Locale } from "./locale";
export { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, type Locale } from "./locale";

const dictionary: Record<string, string> = ko;
// Some server actions return formatted feedback. Match only explicitly catalogued
// sentences, preserving captured names, URLs and other user data verbatim.
const messageTemplates = Object.entries(dictionary)
  .filter(([key]) => /\{\d+\}/.test(key) && key.replace(/\{\d+\}/g, "").length >= 8)
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
  .map(([key, translated]) => {
    const slots: string[] = [];
    const pattern = key.split(/(\{\d+\})/).map((part) => {
      if (/^\{\d+\}$/.test(part)) {
        slots.push(part.slice(1, -1));
        return "(.+?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    return { pattern: new RegExp(`^${pattern}$`), slots, translated };
  });

export function createTranslator(locale: Locale) {
  // Unknown strings (including user-authored content) pass through unchanged.
  return function translate<T>(value: T, params?: Record<string, string | number>): T {
    if (typeof value !== "string") return value;
    const key = value.trim();
    let result: string = value;
    if (locale === "ko") {
      if (Object.hasOwn(dictionary, key)) {
        result = value.replace(key, () => dictionary[key]);
      } else if (!params && key.length <= 2000) {
        for (const template of messageTemplates) {
          const match = template.pattern.exec(key);
          if (!match) continue;
          const captured = Object.fromEntries(template.slots.map((slot, i) => [slot, match[i + 1]]));
          result = value.replace(key, () => template.translated.replace(/\{(\d+)\}/g, (token, slot: string) => captured[slot] ?? token));
          break;
        }
      }
    }
    if (params) result = result.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match));
    return result as T;
  };
}
