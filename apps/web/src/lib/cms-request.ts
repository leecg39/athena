import "server-only";
import { safeFetch } from "@athena/crawler";
import type { CmsRequest } from "@athena/core/content";

/** Publishing requests through the SSRF-safe fetcher (public hosts only, sent once, no redirects). */
export const cmsRequest: CmsRequest = async (url, init) => {
  const r = await safeFetch(url, { method: init.method, headers: init.headers, body: init.body, timeoutMs: 20_000, maxBytes: 1_000_000, accept: "application/json" });
  return { status: r.status, body: r.body };
};
