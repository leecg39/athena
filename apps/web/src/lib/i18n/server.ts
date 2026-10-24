import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createTranslator, LOCALE_COOKIE, resolveLocale } from ".";

export const getLocale = cache(async () => resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value));
export async function getTranslations() {
  return createTranslator(await getLocale());
}
