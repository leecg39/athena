import "server-only";
import { safeFetch } from "@athena/crawler";
import type { ReportTransport } from "@athena/core/reports";
import { DomainError } from "@athena/core/org";
import { appBaseUrl } from "@/lib/email";

/** Report email needs both a Resend key and a verified sender address. */
export const emailDeliveryConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

/**
 * Outgoing report channels: email through Resend, Slack through the website's
 * incoming webhook (sent with the SSRF-safe fetcher). Errors carry only the
 * HTTP status, never the webhook URL or API key.
 */
export function reportTransport(): ReportTransport {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return {
    email:
      key && from
        ? async (m) => {
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey.slice(0, 256) },
              body: JSON.stringify({ from, to: m.to, subject: m.subject, html: m.html, text: m.text }),
              signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) throw new Error(`Resend returned HTTP ${res.status}`);
          }
        : null,
    slack: async (url, text) => {
      const res = await safeFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), timeoutMs: 10_000, maxBytes: 10_000, accept: "text/plain" });
      if (res.status !== 200) throw new Error(`Slack returned HTTP ${res.status}`);
    },
  };
}

/**
 * Base URL for links in outgoing reports. Request headers can be forged, so
 * production sends only with NEXT_PUBLIC_APP_URL configured.
 */
export async function reportLinkBase(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new DomainError("Set NEXT_PUBLIC_APP_URL so report emails link to your app.");
  return appBaseUrl();
}
