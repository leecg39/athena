import "server-only";
import * as z from "zod/v4";
import { db } from "@athena/db";
import { assistantTools, defineTool, systemPrompt, type AssistantTool } from "@athena/core/assistant";
import { fetchGscTopQueries } from "@athena/core/integrations";
import { DomainError } from "@athena/core/org";
import type { Workspace } from "./workspace";
import { gscAccess, gscConnected } from "./integrations";

export interface ConnectorState {
  id: "search_console";
  label: string;
  connected: boolean;
}

/** Data sources Ask Athena can use beyond the workspace analytics. */
export async function connectorsFor(ws: Workspace): Promise<ConnectorState[]> {
  return [{ id: "search_console", label: "Google Search Console", connected: await gscConnected(ws.websiteId) }];
}

function searchConsoleTool(websiteId: string): AssistantTool {
  return defineTool(
    "search_console_queries",
    "Top Google Search queries for the brand's own site from the connected Search Console property, with clicks and impressions over the window. Use it to relate AI visibility to real search demand.",
    z.object({ days: z.number().int().min(7).max(90).default(28), limit: z.number().int().min(1).max(25).default(10) }),
    async ({ days, limit }) => {
      const access = await gscAccess(websiteId);
      if (!access) throw new DomainError("Search Console is not connected");
      const queries = await fetchGscTopQueries({ ...access, days, rowLimit: limit });
      return { property: access.property, days, queries: queries.slice(0, limit) };
    },
  );
}

/** Tools and system prompt for one answer, bound to the signed-in user and website. */
export async function chatSetup(ws: Workspace, opts: { searchConsole?: boolean }): Promise<{ tools: AssistantTool[]; system: string }> {
  const connectors = await connectorsFor(ws);
  const useGsc = opts.searchConsole !== false && connectors.some((c) => c.id === "search_console" && c.connected);
  return {
    tools: [...assistantTools(db, { actorId: ws.user.id, websiteId: ws.websiteId }), ...(useGsc ? [searchConsoleTool(ws.websiteId)] : [])],
    system: systemPrompt({ brand: ws.website.name, domain: ws.website.domain, today: new Date(), connectors: useGsc ? ["Google Search Console (top search queries for the brand's site)"] : [] }),
  };
}
