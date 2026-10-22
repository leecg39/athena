import { streamText, tool, type CoreMessage } from "ai";
import { z } from "zod";
import { requireWorkspace } from "@/lib/workspace";
import { getDashboardData, getResponses, demoSources } from "@/lib/data";

export const maxDuration = 60;

/**
 * Ask Athena: streams an answer grounded in the workspace's own data.
 * Tools give the model read access to metrics, responses and sources.
 * Uses the live provider when an API key is configured; otherwise streams
 * a deterministic summary built from workspace data (no key needed).
 */
export async function POST(req: Request) {
  const ws = await requireWorkspace();
  const { messages } = (await req.json()) as { messages: CoreMessage[] };

  const hasKey = Boolean(process.env.OPENAI_API_KEY);

  if (!hasKey) {
    const data = await getDashboardData();
    const encoder = new TextEncoder();
    const summary = `Here's how ${ws.website.name} is performing in AI search right now:

- **Mention rate**: ${data.summary.mentionRate}% of sampled AI responses mention your brand
- **Citation rate**: ${data.summary.citationRate}% of responses cite your content as a source
- **Share of voice**: ${data.summary.sov}% across tracked competitors
- **Average position**: #${data.summary.position} when mentioned
- **Estimated AI search value**: $${data.summary.value.toLocaleString()}

Top citing sources: ${data.sources.slice(0, 3).map((s) => s.domain).join(", ")}.

Ask me to compare competitors, find content gaps, or recommend what to publish next.`;
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of summary.match(/.{1,24}/gs) ?? []) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const result = await streamText({
    model: (await import("@ai-sdk/openai")).createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-4o"),
    system: `You are Athena, the AI search analyst for brand "${ws.website.name}" (${ws.website.domain}). Answer with the provided tools and cite concrete numbers. Be concise and actionable.`,
    messages,
    tools: {
      getMetrics: tool({
        description: "Get AI search metrics for the brand: mention rate, citation rate, share of voice, position, value.",
        parameters: z.object({}),
        execute: async () => {
          const data = await getDashboardData();
          return data.summary;
        },
      }),
      searchResponses: tool({
        description: "Search sampled AI model responses for the brand.",
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          const rows = await getResponses();
          return rows.filter((r) => r.prompt.includes(query.toLowerCase())).slice(0, 8);
        },
      }),
      getTopSources: tool({
        description: "Get the domains citing the brand most.",
        parameters: z.object({}),
        execute: async () => demoSources().slice(0, 5),
      }),
    },
    maxSteps: 4,
  });

  return result.toTextStreamResponse();
}
