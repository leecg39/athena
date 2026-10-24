/** Links into the app. Production builds set PUBLIC_APP_URL; local builds point at the dev server. */
const configured = (import.meta.env.PUBLIC_APP_URL as string | undefined)?.trim();
if (import.meta.env.PROD && !configured) console.warn("[marketing] PUBLIC_APP_URL is not set; app links point to http://localhost:3000");
export const APP_URL = (configured || "http://localhost:3000").replace(/\/+$/, "");
