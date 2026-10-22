"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Spreadsheet-style content grid with AI agent columns (observed Content Hub pattern). */
export function ContentGrid() {
  const router = useRouter();
  const [rows, setRows] = useState([
    { id: "c1", title: "Accessibility Design Guidelines for Developers and Designers", status: "published", agent: "done", citations: 391 },
    { id: "c2", title: "Best AI design tools for product teams (2026)", status: "draft", agent: "ready", citations: 0 },
    { id: "c3", title: "Design tokens: the complete automation guide", status: "brief", agent: "pending", citations: 0 },
    { id: "c4", title: "Canvasly vs Figma vs Canva: honest comparison", status: "review", agent: "ready", citations: 0 },
  ]);
  const [reviseFor, setReviseFor] = useState<string | null>(null);

  const revise = (id: string) => {
    setReviseFor(id);
    setTimeout(() => {
      setRows((all) => all.map((r) => (r.id === id ? { ...r, status: "review", agent: "done" } : r)));
      setReviseFor(null);
    }, 1200);
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="table-base">
        <thead>
          <tr>
            <th>Title</th>
            <th>AI Agent</th>
            <th>Status</th>
            <th>Citations (30d)</th>
            <th>Publish</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="max-w-md">
                <span className="text-brand-600">{r.title}</span>
              </td>
              <td>
                {reviseFor === r.id ? (
                  <span className="badge bg-brand-50 text-brand-600">Athena revising…</span>
                ) : r.agent === "done" ? (
                  <span className="badge bg-emerald-50 text-emerald-600">Ready for review</span>
                ) : (
                  <span className="badge bg-gray-100 text-gray-500">{r.agent}</span>
                )}
              </td>
              <td>
                <span className={`badge ${r.status === "published" ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-500"}`}>
                  {r.status}
                </span>
              </td>
              <td className="text-gray-600">{r.citations || "—"}</td>
              <td>
                <select className="input max-w-36 !py-1 text-xs">
                  <option>WordPress</option>
                  <option>Webflow</option>
                  <option>Contentful</option>
                  <option>Sanity</option>
                  <option>Wix</option>
                  <option>Framer</option>
                  <option>Payload CMS</option>
                  <option>Shopify</option>
                </select>
              </td>
              <td className="text-right">
                <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => revise(r.id)}>
                  {reviseFor === r.id ? "…" : "✎ Revise with Athena"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-gray-50 p-3">
        <button className="btn-secondary text-xs" onClick={() => router.push("/content/catalog-optimization")}>
          Open Catalog Optimization (Shopify) →
        </button>
      </div>
    </div>
  );
}
