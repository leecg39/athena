/**
 * Athenum MCP server — lets ChatGPT / Claude (or any MCP client) read
 * AI-search data and create content against the public /api/v1.
 *
 * Transport: stdio. Configure in the client:
 *   { "mcpServers": { "athenum": { "command": "node",
 *       "args": ["<repo>/apps/mcp/dist/index.js"],
 *       "env": { "ATHENUM_API_KEY": "ah_live_…", "ATHENUM_API_URL": "https://app.example.com" } } } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.ATHENUM_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.ATHENUM_API_KEY ?? "";

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

const server = new McpServer({ name: "athenum", version: "0.1.0" });

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
    const q = new URLSearchParams({ websiteId, ...(model ? { model } : {}), ...(since ? { since } : {}) });
    const data = await api(`/responses?${q.toString()}`);
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
    // Content creation flows through the internal app API in the web app;
    // here we expose it via the prompts-anchored content pipeline.
    const data = await api("/content", {
      method: "POST",
      body: JSON.stringify({ websiteId, title, promptId }),
    });
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("athenum mcp server running on stdio");
