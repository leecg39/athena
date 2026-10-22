import "server-only";

/** Escape text for safe interpolation into HTML email bodies. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/**
 * Send a transactional email through Resend. Returns false (without throwing)
 * when email delivery is not configured, so callers can fall back to links.
 */
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Athenum <noreply@example.com>", to: opts.to, subject: opts.subject, html: opts.html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("[email] resend failed", res.status, await res.text());
    return false;
  }
  return true;
}

export async function appBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
