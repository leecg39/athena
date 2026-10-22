import Link from "next/link";
import { db } from "@athena/db";
import { getIntegration } from "@athena/core/integrations";
import type { WebsiteRow } from "@athena/core/tenancy";
import { gscConfigured } from "@/lib/integrations";
import { skipStep } from "../actions";

const RESULT: Record<string, string> = {
  connected: "Search Console connected.",
  no_property: "No verified Search Console property matches this domain. Add the site in Search Console, then try again.",
  no_refresh_token: "Google did not grant offline access. Please try connecting again.",
  denied: "Access was not granted.",
  error: "Search Console could not be connected. Please try again.",
};

export async function SearchConsoleStep({ site, result }: { site: WebsiteRow; result?: string }) {
  const status = await getIntegration(db, site.id, "gsc");
  const connected = status?.status === "connected";
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Connect Google Search Console to discover prompts from the real queries that bring people to {site.domain}, and to compare organic
        and AI search performance. Access is read-only.
      </p>
      {result && RESULT[result] ? (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${result === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
          {RESULT[result]}
        </p>
      ) : null}
      {connected ? (
        <p className="text-sm text-emerald-700">Connected property: {status?.externalAccount}</p>
      ) : gscConfigured() ? (
        <Link href={`/api/integrations/gsc/connect?websiteId=${site.id}`} className="btn-secondary inline-flex">
          Connect Google Search Console
        </Link>
      ) : (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          Google OAuth is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). You can connect later from Settings → Integrations.
        </p>
      )}
      <form action={skipStep}>
        <input type="hidden" name="websiteId" value={site.id} />
        <input type="hidden" name="step" value="search-console" />
        <button type="submit" className="btn-primary">
          {connected ? "Continue" : "Skip for now"}
        </button>
      </form>
    </div>
  );
}
