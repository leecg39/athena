/**
 * Athenum MCP server — lets ChatGPT / Claude (or any MCP client) read
 * AI-search data, query Knowledge Base / Teams / Billing, and create content against `/api/v1`.
 *
 * Transport: stdio. Configure in the client:
 *   { "mcpServers": { "athenum": { "command": "node",
 *       "args": ["<repo>/apps/mcp/dist/index.js"],
 *       "env": { "ATHENUM_API_KEY": "ath_…", "ATHENUM_API_URL": "https://app.example.com" } } } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.ATHENUM_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.ATHENUM_API_KEY ?? "";

export const MCP_TOOL_NAMES = [
  "list_websites",
  "list_prompts",
  "get_basics",
  "get_metrics",
  "get_sources",
  "search_responses",
  "get_knowledge_base",
  "create_kb_fact",
  "create_content",
  "get_billing_credits",
  "get_teams",
  "get_bi_connector_feed",
  "start_collection",
  "get_collection_status",
] as const;

export async function api(
  path: string,
  init?: RequestInit,
  customEnv?: { apiUrl?: string; apiKey?: string },
): Promise<unknown> {
  const baseUrl = customEnv?.apiUrl ?? API_URL;
  const key = customEnv?.apiKey ?? API_KEY;
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function createAthenumMcpServer(): McpServer {
  const server = new McpServer({ name: "athenum", version: "0.2.0" });

  server.tool(
    "list_websites",
    "List tracked brands/websites in the organization",
    {},
    async () => {
      const data = await api("/websites");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "list_prompts",
    "List tracked prompts for a website",
    { websiteId: z.string().describe("Website id from list_websites") },
    async ({ websiteId }) => {
      const data = await api(`/prompts?websiteId=${websiteId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_basics",
    "Get website taxonomy entities (topics | competitors | personas | locations | tags | schedules)",
    {
      websiteId: z.string(),
      entity: z.enum(["topics", "competitors", "personas", "locations", "tags", "schedules"]),
    },
    async ({ websiteId, entity }) => {
      const data = await api(`/basics/${entity}?websiteId=${websiteId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_metrics",
    "Get AI-search metrics (share-of-voice | mention-rate | citation-rate | position). window: cumulative | over-time",
    {
      websiteId: z.string(),
      kind: z.enum(["share-of-voice", "mention-rate", "citation-rate", "position"]),
      window: z.enum(["cumulative", "over-time"]).default("cumulative"),
    },
    async ({ websiteId, kind, window }) => {
      const data = await api(`/metrics/${kind}?websiteId=${websiteId}&window=${window}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_sources",
    "Get the domains citing the brand most",
    { websiteId: z.string() },
    async ({ websiteId }) => {
      const data = await api(`/sources?websiteId=${websiteId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "search_responses",
    "Query collected AI-model responses for a website",
    {
      websiteId: z.string(),
      model: z.string().optional(),
      since: z.string().optional().describe("ISO date, e.g. 2026-10-01"),
    },
    async ({ websiteId, model, since }) => {
      const q = new URLSearchParams({
        websiteId,
        ...(model ? { model } : {}),
        ...(since ? { since } : {}),
      });
      const data = await api(`/responses?${q.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_knowledge_base",
    "Read Knowledge Base pillars, canonical brand facts, and Oracle accuracy findings",
    {
      websiteId: z.string(),
      section: z.enum(["all", "pillars", "facts", "oracle"]).default("all"),
    },
    async ({ websiteId, section }) => {
      const data = await api(`/kb?websiteId=${websiteId}&section=${section}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "create_kb_fact",
    "Add a canonical brand fact to the Knowledge Base",
    {
      websiteId: z.string(),
      claim: z.string(),
      sourceUrl: z.string().optional(),
      status: z.enum(["pending_review", "confirmed"]).default("confirmed"),
    },
    async ({ websiteId, claim, sourceUrl, status }) => {
      const data = await api("/kb", {
        method: "POST",
        body: JSON.stringify({ websiteId, kind: "fact", claim, sourceUrl, status }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "create_content",
    "Create a content item (idea/brief) grounded in a prompt opportunity",
    {
      websiteId: z.string(),
      title: z.string(),
      promptId: z.string().optional(),
    },
    async ({ websiteId, title, promptId }) => {
      const data = await api("/content", {
        method: "POST",
        body: JSON.stringify({ websiteId, title, promptId }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_billing_credits",
    "Get organization, website, and group credit balances, ledger, and invoices",
    {
      scope: z.enum(["all", "organization", "website", "group"]).default("all"),
    },
    async ({ scope }) => {
      const data = await api(`/billing/credits?scope=${scope}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_teams",
    "List organization members, portfolio groups, tracked websites, and custom roles",
    {},
    async () => {
      const data = await api("/teams");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_bi_connector_feed",
    "Fetch Looker Studio or Power BI daily AI visibility connector dataset",
    {
      provider: z.enum(["looker-studio", "power-bi"]).default("looker-studio"),
      websiteId: z.string().optional(),
      days: z.number().int().min(1).max(90).default(14),
    },
    async ({ provider, websiteId, days }) => {
      const q = new URLSearchParams({
        days: String(days),
        ...(websiteId ? { websiteId } : {}),
      });
      const data = await api(`/connectors/${provider}?${q.toString()}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "start_collection",
    "Start an on-demand response collection run for a website (consumes credits)",
    { websiteId: z.string(), promptIds: z.array(z.string()).optional() },
    async ({ websiteId, promptIds }) => {
      const data = await api("/response-streaming", {
        method: "POST",
        body: JSON.stringify({ websiteId, promptIds }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_collection_status",
    "Poll a collection run by runId",
    { runId: z.string() },
    async ({ runId }) => {
      const data = await api(`/response-streaming/status?runId=${runId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  return server;
}

if (process.env.NODE_ENV !== "test" && process.env.ATHENUM_MCP_AUTOSTART !== "false") {
  const server = createAthenumMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("athenum mcp server running on stdio");
}
