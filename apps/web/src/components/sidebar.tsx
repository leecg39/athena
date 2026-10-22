"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { section: "Analyze", items: [
    { href: "/home", label: "Home", icon: "🏠" },
    { href: "/olympus", label: "Olympus Dashboard", icon: "📊" },
    { href: "/responses", label: "Responses", icon: "💬" },
    { href: "/sources", label: "Sources", icon: "🌐" },
    { href: "/competitors", label: "Competitors", icon: "🎯" },
  ]},
  { section: "Discover & Act", items: [
    { href: "/prompts", label: "Prompts", icon: "🔍" },
    { href: "/insights", label: "Insights", icon: "💡" },
    { href: "/content", label: "Content", icon: "📝" },
    { href: "/outreach", label: "Outreach", icon: "📮" },
    { href: "/knowledge-base", label: "Knowledge Base", icon: "📚" },
  ]},
  { section: "More", items: [
    { href: "/oracle", label: "Oracle", icon: "🔮" },
    { href: "/shopping", label: "Shopping", icon: "🛒" },
    { href: "/site-health", label: "Site Health", icon: "🩺" },
    { href: "/ads", label: "Ads", icon: "📢" },
    { href: "/pitches", label: "Pitches", icon: "🚀" },
    { href: "/reports", label: "Reports", icon: "📅" },
  ]},
];

export function Sidebar({
  websiteName,
  websiteDomain,
  websites,
  credits,
  userEmail,
}: {
  websiteName: string;
  websiteDomain: string;
  websites: { id: string; name: string }[];
  credits: number;
  userEmail: string;
}) {
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-100 bg-gray-50/60">
      {/* workspace switcher */}
      <div className="relative p-3">
        <button
          onClick={() => setSwitcherOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-left hover:bg-gray-50"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">
            {websiteName.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900">{websiteName}</div>
            <div className="truncate text-[11px] text-gray-400">{websiteDomain}</div>
          </div>
          <span className="text-gray-300">⌄</span>
        </button>
        {switcherOpen ? (
          <div className="absolute left-3 right-3 top-14 z-20 rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
            {websites.map((w) => (
              <Link
                key={w.id}
                href={`/olympus?ws=${w.id}`}
                className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setSwitcherOpen(false)}
              >
                {w.name}
              </Link>
            ))}
            <Link href="/onboarding" className="block border-t border-gray-50 px-3 py-2 text-sm text-brand-600 hover:bg-gray-50" onClick={() => setSwitcherOpen(false)}>
              + Add website
            </Link>
          </div>
        ) : null}
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((group) => (
          <div key={group.section} className="mb-4">
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {group.section}
            </div>
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                    active ? "bg-brand-50 font-medium text-brand-600" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <span className="text-[13px]">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* footer: credits + settings */}
      <div className="border-t border-gray-100 p-3">
        <div className="mb-2 rounded-lg bg-white p-3 text-xs text-gray-500 shadow-sm">
          <div className="flex justify-between">
            <span>Credits</span>
            <span className="font-semibold text-gray-900">{credits.toLocaleString()}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (credits / 3000) * 100)}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Link href="/settings/general" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-600">
              {(userEmail || "U").slice(0, 2).toUpperCase()}
            </span>
            Settings
          </Link>
          <Link href="/organization" className="rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:bg-gray-100" title="Organization">
            ⚙
          </Link>
        </div>
      </div>
    </aside>
  );
}
