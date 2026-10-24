"use client";
import { useTranslations } from "@/components/locale-provider";


import Link from "next/link";
import type { ConnectorState } from "@/lib/assistant";

export function ConnectorsBar({
  connectors,
  searchConsole,
  onToggleSearchConsole,
}: {
  connectors: ConnectorState[];
  searchConsole: boolean;
  onToggleSearchConsole: (next: boolean) => void;
}) {
  const tt = useTranslations();
  const gsc = connectors.find((c) => c.id === "search_console");

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-600" title={tt("Mentions, citations, competitors, sources and sampled AI answers")}>
        {tt("✓ Workspace analytics")}</span>
      {gsc ? (
        gsc.connected ? (
          <button
            type="button"
            aria-pressed={searchConsole}
            onClick={() => onToggleSearchConsole(!searchConsole)}
            className={`rounded-full border px-2.5 py-0.5 font-medium transition ${
              searchConsole
                ? "border-brand-200 bg-brand-50 text-brand-600"
                : "border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-700"
            }`}
            title={tt("Include top Google Search Console queries in Athena's tools")}
          >
            {tt(searchConsole ? "✓ " : "")}
            {tt(gsc.label)}: {tt(searchConsole ? "On" : "Off")}
          </button>
        ) : (
          <Link
            href="/settings/integrations"
            className="rounded-full border border-dashed border-gray-200 bg-white px-2.5 py-0.5 text-gray-500 hover:border-brand-300 hover:text-brand-600"
            title={tt("Connect Google Search Console in Settings → Integrations")}
          >
            {tt("+ Connect ")}{tt(gsc.label)}
          </Link>
        )
      ) : null}
    </div>
  );
}
