import "server-only";
import { safeFetch } from "@athena/crawler";

/** HTML of a public page via the SSRF-safe fetcher, or null when it cannot be read. */
export async function fetchPageHtml(url: string): Promise<{ html: string } | null> {
  try {
    const r = await safeFetch(url, { timeoutMs: 8_000, maxBytes: 1_500_000, accept: "text/html,application/xhtml+xml" });
    if (r.status >= 400 || !/html/i.test(r.contentType)) return null;
    return { html: r.body };
  } catch (err) {
    console.warn("[page-fetch] could not read", url, err instanceof Error ? err.message : err);
    return null;
  }
}
