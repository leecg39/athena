import "server-only";
import { db } from "@athena/db";
import { fetchGscTopQueries } from "@athena/core/integrations";
import { listPrompts, candidatesFromSearchConsole, competitorGapCandidates, mergeCandidates, type PromptCandidate } from "@athena/core/prompts";
import type { Workspace } from "./workspace";
import { gscAccess, gscConnected } from "./integrations";
import { getCompetitorList } from "./data";
import { promptSuggestions } from "./onboarding-suggestions";

export interface DiscoveryResult {
  candidates: PromptCandidate[];
  notes: string[];
}

async function trackedSet(ws: Workspace): Promise<Set<string>> {
  const all = await listPrompts(db, { actorId: ws.user.id, websiteId: ws.websiteId, limit: 500 });
  return new Set(all.rows.map((r) => r.text.toLowerCase()));
}

async function searchConsoleCandidates(ws: Workspace, tracked: Set<string>, notes: string[]): Promise<PromptCandidate[]> {
  if (!(await gscConnected(ws.websiteId))) {
    notes.push("Connect Google Search Console to discover prompts from real search demand.");
    return [];
  }
  try {
    const access = await gscAccess(ws.websiteId);
    if (!access) return [];
    return candidatesFromSearchConsole(await fetchGscTopQueries(access), tracked);
  } catch (err) {
    console.error("[discover] search console failed", err);
    notes.push("Search Console data could not be loaded right now.");
    return [];
  }
}

export async function runDiscovery(ws: Workspace): Promise<DiscoveryResult> {
  const notes: string[] = [];
  const tracked = await trackedSet(ws);
  const [gsc, gap, comps] = await Promise.all([
    searchConsoleCandidates(ws, tracked, notes),
    competitorGapCandidates(db, { websiteId: ws.websiteId, brandName: ws.website.name, tracked }),
    getCompetitorList(ws.websiteId),
  ]);
  if (!gap.length) notes.push("Competitor-gap prompts appear once AI responses have been collected.");
  const site = await promptSuggestions(ws.website, comps);
  if (site.source !== "ai") notes.push("AI site analysis is unavailable — site-based ideas are templates from your brand profile.");
  const siteList: PromptCandidate[] = site.data
    .flatMap((t) => t.prompts)
    .filter((p) => !tracked.has(p.toLowerCase()))
    .map((text) => ({ text, source: site.source === "ai" ? ("site" as const) : ("template" as const), volume: 0 }));
  return { candidates: mergeCandidates([gsc, gap, siteList]), notes };
}
