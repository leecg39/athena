"use client";

import { useActionState, useState } from "react";
import type {
  SiteHealthBotSummary,
  SiteHealthKeywordRow,
  SiteHealthPageItem,
  SiteHealthPropertyGroup,
  SiteHealthStagingRow,
} from "@athena/core/site-health";
import {
  runSiteHealthCrawlAction,
  runStagingReleaseCheckAction,
  createSiteHealthPageAction,
  updatePageOptimizationAction,
  verifyLivePageContentAction,
  deleteSiteHealthPageAction,
} from "@/app/(app)/site-health/actions";
import type { ActionState } from "@/lib/action-state";

const idle: ActionState = { ok: false };

interface Props {
  siteDomain: string;
  pages: SiteHealthPageItem[];
  botAccessMatrix: SiteHealthBotSummary[];
  keywords: SiteHealthKeywordRow[];
  stagingComparisons: SiteHealthStagingRow[];
  properties: SiteHealthPropertyGroup[];
  optimizations: {
    needsEdit: SiteHealthPageItem[];
    staged: SiteHealthPageItem[];
    verifiedLive: SiteHealthPageItem[];
  };
  canWrite: boolean;
}

export function SiteHealthView(props: Props) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "keywords" | "staging" | "sitemap" | "optimizations"
  >("overview");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [lastKey, setLastKey] = useState<string>("crawl");

  const [crawlState, crawlAct, crawlPending] = useActionState(runSiteHealthCrawlAction, idle);
  const [stagingState, stagingAct, stagingPending] = useActionState(runStagingReleaseCheckAction, idle);
  const [createState, createAct, createPending] = useActionState(createSiteHealthPageAction, idle);
  const [optState, optAct, optPending] = useActionState(updatePageOptimizationAction, idle);
  const [verifyState, verifyAct, verifyPending] = useActionState(verifyLivePageContentAction, idle);
  const [deleteState, deleteAct, deletePending] = useActionState(deleteSiteHealthPageAction, idle);

  const stateMap: Record<string, ActionState> = {
    crawl: crawlState,
    staging: stagingState,
    create: createState,
    opt: optState,
    verify: verifyState,
    delete: deleteState,
  };
  const ordered = [
    stateMap[lastKey] ?? idle,
    ...Object.entries(stateMap)
      .filter(([k]) => k !== lastKey)
      .map(([, v]) => v),
  ];
  const errorMsg = ordered.find((s) => s.error)?.error;
  const infoMsg = ordered.find((s) => s.message)?.message;

  const filteredPages = props.pages.filter((p) => {
    if (propertyFilter !== "all" && p.property !== propertyFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${p.path} ${p.title} ${p.property} ${p.healthDetail}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg border border-gray-200 p-0.5">
            <button
              type="button"
              data-testid="site-health-tab-overview"
              onClick={() => setActiveTab("overview")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "overview" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Overview &amp; AI Crawlers ({props.pages.length})
            </button>
            <button
              type="button"
              data-testid="site-health-tab-keywords"
              onClick={() => setActiveTab("keywords")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "keywords" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Keywords &amp; Rankings ({props.keywords.length})
            </button>
            <button
              type="button"
              data-testid="site-health-tab-staging"
              onClick={() => setActiveTab("staging")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "staging" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Staging Checks (Release Diff)
            </button>
            <button
              type="button"
              data-testid="site-health-tab-sitemap"
              onClick={() => setActiveTab("sitemap")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "sitemap" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Sitemap &amp; Crawl Scope ({props.properties.length})
            </button>
            <button
              type="button"
              data-testid="site-health-tab-optimizations"
              onClick={() => setActiveTab("optimizations")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                activeTab === "optimizations" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Optimization Board &amp; Live Verify
            </button>
          </div>
        </div>

        {props.canWrite ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              + Track page path
            </button>
            <form action={stagingAct} onSubmit={() => setLastKey("staging")}>
              <input type="hidden" name="stagingHost" value={`staging.${props.siteDomain}`} />
              <button
                type="submit"
                disabled={stagingPending}
                className="btn-secondary !px-3 !py-1.5 text-xs"
              >
                {stagingPending ? "Checking staging…" : "Staging checks"}
              </button>
            </form>
            <form action={crawlAct} onSubmit={() => setLastKey("crawl")}>
              <button
                type="submit"
                disabled={crawlPending}
                className="btn-primary !px-3 !py-1.5 text-xs"
              >
                {crawlPending ? "Crawling…" : "Crawl now"}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {/* Banners */}
      {errorMsg ? (
        <div
          role="alert"
          data-testid="site-health-error-banner"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {errorMsg}
        </div>
      ) : null}
      {!errorMsg && infoMsg ? (
        <div
          role="status"
          data-testid="site-health-status-banner"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
        >
          {infoMsg}
        </div>
      ) : null}

      {/* Expandable Add Page Form */}
      {showAddForm && props.canWrite ? (
        <form
          action={createAct}
          onSubmit={() => setLastKey("create")}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Add Page Path to Site Health &amp; Crawl Scope
            </div>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-gray-400">
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-6">
            <input
              name="url"
              required
              placeholder="/solutions/enterprise-design"
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <input
              name="title"
              required
              placeholder="Page title (e.g. Enterprise Design Governance)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs md:col-span-2"
            />
            <select
              name="property"
              defaultValue="Marketing & Core"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
            >
              <option value="Marketing & Core">Marketing &amp; Core</option>
              <option value="Documentation & Specs">Documentation &amp; Specs</option>
              <option value="Blog & Guides">Blog &amp; Guides</option>
            </select>
            <input
              name="keyword"
              placeholder="Target keyword (optional)"
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <button type="submit" disabled={createPending} className="btn-primary !px-3 !py-2 text-xs">
              {createPending ? "Adding…" : "Add Page"}
            </button>
          </div>
        </form>
      ) : null}

      {/* TAB 1: Overview & AI Crawlers */}
      {activeTab === "overview" ? (
        <div className="space-y-5">
          {/* 10-Bot AI Crawler Accessibility Matrix */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  AI Search Crawler Accessibility (robots.txt &amp; HTTP Evaluation)
                </div>
                <div className="text-xs text-gray-400">
                  Live access verification for OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot, Google-Extended, and AthenaBot
                </div>
              </div>
            </div>
            <div
              data-testid="site-health-bot-matrix"
              className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5"
            >
              {props.botAccessMatrix.map((b) => (
                <div
                  key={b.bot}
                  className={`rounded-lg border p-3 ${
                    b.status === "allowed"
                      ? "border-emerald-200 bg-emerald-50/40"
                      : b.status === "partial"
                        ? "border-amber-200 bg-amber-50/40"
                        : "border-red-200 bg-red-50/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-gray-900">{b.bot}</span>
                    <span
                      className={`badge text-[10px] ${
                        b.status === "allowed"
                          ? "bg-emerald-100 text-emerald-700"
                          : b.status === "partial"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {b.status === "allowed"
                        ? "Allowed"
                        : b.status === "partial"
                          ? "Partial"
                          : "Blocked"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-gray-600">
                    {b.owner} · {b.purpose}
                  </div>
                  <div className="mt-1.5 text-[11px] text-gray-500">{b.ruleSummary}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Page Health Audit Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="table-base" data-testid="site-health-pages-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Crawl Property</th>
                  <th>Status</th>
                  <th>HTTP / Sitemap / llms.txt</th>
                  <th>Diagnostic Detail</th>
                  {props.canWrite ? <th className="text-right">Live Verification &amp; Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredPages.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="font-mono text-xs font-semibold text-brand-700">{p.path}</div>
                      <div className="text-xs text-gray-500">{p.title}</div>
                    </td>
                    <td>
                      <span className="badge bg-gray-100 text-gray-700">{p.property}</span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          p.healthStatus === "pass"
                            ? "bg-emerald-50 text-emerald-700"
                            : p.healthStatus === "warn"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700"
                        }`}
                      >
                        {p.healthStatus}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1 text-[11px]">
                        <span className="badge bg-gray-100 text-gray-700">HTTP {p.statusCode}</span>
                        <span
                          className={`badge ${
                            p.inSitemap ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {p.inSitemap ? "In sitemap.xml" : "Not in sitemap"}
                        </span>
                        <span
                          className={`badge ${
                            p.llmsTxtPresent ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {p.llmsTxtPresent ? "llms.txt ✓" : "llms.txt missing"}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-xs text-xs text-gray-600">{p.healthDetail}</td>
                    {props.canWrite ? (
                      <td className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <form action={verifyAct} onSubmit={() => setLastKey("verify")}>
                            <input type="hidden" name="pageId" value={p.id} />
                            <button
                              type="submit"
                              disabled={verifyPending}
                              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                            >
                              ✓ Verify live
                            </button>
                          </form>
                          <form action={deleteAct} onSubmit={() => setLastKey("delete")}>
                            <input type="hidden" name="pageId" value={p.id} />
                            <button
                              type="submit"
                              disabled={deletePending}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </form>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* TAB 2: Keywords & Rankings */}
      {activeTab === "keywords" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="table-base" data-testid="site-health-keywords-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Rank Position</th>
                <th>7d Change</th>
                <th>Monthly Volume</th>
                <th>Target Page</th>
                <th>AI Accessible</th>
              </tr>
            </thead>
            <tbody>
              {props.keywords.map((k, idx) => (
                <tr key={`${k.pageId}-${k.keyword}-${idx}`}>
                  <td className="font-semibold text-gray-900">{k.keyword}</td>
                  <td className="font-mono text-xs font-bold text-brand-700">#{k.position}</td>
                  <td>
                    <span
                      className={`badge ${
                        k.change > 0
                          ? "bg-emerald-50 text-emerald-700"
                          : k.change < 0
                            ? "bg-red-50 text-red-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {k.change > 0 ? `▲ +${k.change}` : k.change < 0 ? `▼ ${k.change}` : "— 0"}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{k.volume.toLocaleString()}</td>
                  <td>
                    <div className="font-mono text-xs text-brand-700">{k.path}</div>
                    <div className="text-[11px] text-gray-400">{k.title}</div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        k.aiAccessible ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      }`}
                    >
                      {k.aiAccessible ? "Accessible" : "Blocked"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* TAB 3: Staging Release Checks */}
      {activeTab === "staging" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                Staging vs. Production Release Comparison
              </div>
              <div className="text-xs text-gray-500">
                Compare HTTP status codes, robots.txt AI crawler rules, and schema markup between{" "}
                <span className="font-mono font-medium">{props.siteDomain}</span> and{" "}
                <span className="font-mono font-medium">staging.{props.siteDomain}</span> before deploying
              </div>
            </div>
            {props.canWrite ? (
              <form
                action={stagingAct}
                onSubmit={() => setLastKey("staging")}
                className="flex items-center gap-2"
              >
                <input
                  name="stagingHost"
                  defaultValue={`staging.${props.siteDomain}`}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-xs"
                />
                <button type="submit" disabled={stagingPending} className="btn-primary !px-3 !py-1.5 text-xs">
                  {stagingPending ? "Comparing…" : "Run Release Diff"}
                </button>
              </form>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="table-base" data-testid="site-health-staging-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Production</th>
                  <th>Staging</th>
                  <th>Release Gate</th>
                  <th>Comparison Summary</th>
                  {props.canWrite ? <th className="text-right">Remediate</th> : null}
                </tr>
              </thead>
              <tbody>
                {props.stagingComparisons.map((s) => (
                  <tr key={s.pageId}>
                    <td>
                      <div className="font-mono text-xs font-semibold text-brand-700">{s.path}</div>
                      <div className="text-xs text-gray-500">{s.title}</div>
                    </td>
                    <td>
                      <span className="badge bg-gray-100 text-gray-700">
                        HTTP {s.prodStatus} · {s.prodAiAccessible ? "AI OK" : "Blocked"}
                      </span>
                    </td>
                    <td>
                      <span className="badge bg-gray-100 text-gray-700">
                        HTTP {s.stagingStatus} · {s.stagingAiAccessible ? "AI OK" : "Blocked"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          s.hasRegression ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {s.hasRegression ? "Regression" : "Ready to ship"}
                      </span>
                    </td>
                    <td className="text-xs text-gray-600">{s.diffSummary}</td>
                    {props.canWrite ? (
                      <td className="text-right">
                        {s.hasRegression ? (
                          <form action={verifyAct} onSubmit={() => setLastKey("verify")}>
                            <input type="hidden" name="pageId" value={s.pageId} />
                            <button
                              type="submit"
                              disabled={verifyPending}
                              className="rounded border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
                            >
                              Fix &amp; Verify Live
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-emerald-600">Passing ✓</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* TAB 4: Sitemap & Crawl Scope Properties */}
      {activeTab === "sitemap" ? (
        <div className="space-y-4">
          <div
            data-testid="site-health-properties-grid"
            className="grid gap-4 md:grid-cols-3"
          >
            {props.properties.map((prop) => (
              <div key={prop.property} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">{prop.property}</span>
                  <span className="badge bg-brand-50 text-brand-700">{prop.pageCount} pages</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[10px] text-gray-400">Healthy</div>
                    <div className="text-sm font-bold text-emerald-700">
                      {prop.healthyCount}/{prop.pageCount}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[10px] text-gray-400">AI Access</div>
                    <div className="text-sm font-bold text-gray-900">{prop.aiAccessiblePct}%</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[10px] text-gray-400">In Sitemap</div>
                    <div className="text-sm font-bold text-brand-700">
                      {prop.inSitemapCount}/{prop.pageCount}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Sitemap URL</th>
                  <th>Crawl Scope Property</th>
                  <th>Sitemap Status</th>
                  <th>llms.txt Index</th>
                  <th>Structured Schema</th>
                </tr>
              </thead>
              <tbody>
                {props.pages.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs text-brand-700">{p.url}</td>
                    <td className="text-xs text-gray-600">{p.property}</td>
                    <td>
                      <span
                        className={`badge ${
                          p.inSitemap && p.statusCode === 200
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {p.inSitemap && p.statusCode === 200
                          ? "Indexed in /sitemap.xml"
                          : `HTTP ${p.statusCode} · Sitemap issue`}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          p.llmsTxtPresent ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {p.llmsTxtPresent ? "Listed in /llms.txt" : "Missing from /llms.txt"}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {p.schemaMarkup.length > 0 ? (
                          p.schemaMarkup.map((s) => (
                            <span key={s} className="badge bg-gray-100 text-[10px] text-gray-700">
                              {s}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">None</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* TAB 5: Optimization Board & Live Content Verification */}
      {activeTab === "optimizations" ? (
        <div
          data-testid="site-health-optimization-board"
          className="grid gap-4 md:grid-cols-3"
        >
          {/* Column 1: Needs Edit */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800">Needs Edit</div>
                <div className="text-[11px] text-gray-400">
                  Pages with blocked AI bots, 404s, or missing llms.txt
                </div>
              </div>
              <span className="badge bg-white text-gray-700">
                {props.optimizations.needsEdit.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {props.optimizations.needsEdit.map((p) => (
                <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="font-mono text-xs font-semibold text-brand-700">{p.path}</div>
                  <div className="mt-0.5 text-xs font-medium text-gray-800">{p.title}</div>
                  <div className="mt-1.5 text-[11px] text-amber-700">
                    {p.optimizationRecommendation}
                  </div>
                  {props.canWrite ? (
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <form action={optAct} onSubmit={() => setLastKey("opt")}>
                        <input type="hidden" name="pageId" value={p.id} />
                        <input type="hidden" name="optimizationStatus" value="staged" />
                        <button
                          type="submit"
                          disabled={optPending}
                          className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                        >
                          → Stage Fix
                        </button>
                      </form>
                      <form action={verifyAct} onSubmit={() => setLastKey("verify")}>
                        <input type="hidden" name="pageId" value={p.id} />
                        <button
                          type="submit"
                          disabled={verifyPending}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                        >
                          ✓ Verify Live
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* Column 2: Staged for Release */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800">Staged for Verification</div>
                <div className="text-[11px] text-gray-400">
                  Edits staged — run live content verification
                </div>
              </div>
              <span className="badge bg-white text-gray-700">
                {props.optimizations.staged.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {props.optimizations.staged.map((p) => (
                <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="font-mono text-xs font-semibold text-brand-700">{p.path}</div>
                  <div className="mt-0.5 text-xs font-medium text-gray-800">{p.title}</div>
                  <div className="mt-1.5 text-[11px] text-gray-600">
                    {p.optimizationRecommendation}
                  </div>
                  {props.canWrite ? (
                    <div className="mt-2.5">
                      <form action={verifyAct} onSubmit={() => setLastKey("verify")}>
                        <input type="hidden" name="pageId" value={p.id} />
                        <button
                          type="submit"
                          disabled={verifyPending}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                        >
                          ✓ Run Live Content Verification
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* Column 3: Verified Live */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800">Verified Live</div>
                <div className="text-[11px] text-gray-400">
                  Cryptographically verified on live domain
                </div>
              </div>
              <span className="badge bg-white text-emerald-700">
                {props.optimizations.verifiedLive.length}
              </span>
            </div>
            <div className="space-y-2.5">
              {props.optimizations.verifiedLive.map((p) => (
                <div key={p.id} className="rounded-lg border border-emerald-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-brand-700">{p.path}</span>
                    <span className="badge bg-emerald-50 text-[10px] text-emerald-700">
                      Verified ✓
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-gray-800">{p.title}</div>
                  {p.verificationHash ? (
                    <div className="mt-1.5 font-mono text-[10px] text-gray-400">
                      Hash: {p.verificationHash}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
