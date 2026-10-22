import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  OpenAiSearchAdapter,
  PerplexitySearchAdapter,
  GeminiSearchAdapter,
  ChatCompletionsAdapter,
  XaiSearchAdapter,
  AnthropicSearchAdapter,
  configuredAdapters,
  simulatedEnabled,
  ProviderError,
} from "./index";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAI Responses adapter", () => {
  it("sends the web search tool with location and parses url citations", async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toEqual([{ type: "web_search", user_location: { type: "approximate", country: "KR" } }]);
      return json({
        output: [
          { type: "web_search_call" },
          { type: "message", content: [{ type: "output_text", text: "Use Acme.", annotations: [{ type: "url_citation", url: "https://acme.com/a", title: "A" }, { type: "url_citation", url: "https://acme.com/a" }] }] },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });
    const r = await new OpenAiSearchAdapter("k", "gpt-x", fetchImpl).collect("q", { country: "KR" });
    expect(r).toMatchObject({ text: "Use Acme.", citations: [{ url: "https://acme.com/a", title: "A" }], provider: "openai:gpt-x", tokensIn: 10, tokensOut: 20 });
  });

  it("maps HTTP failures to ProviderError without leaking bodies", async () => {
    const err = await new OpenAiSearchAdapter("k", "m", async () => json({ error: { message: "secret detail" } }, 429)).collect("q").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(429);
    expect(err.message).not.toContain("secret");
  });
});

describe("Perplexity / Gemini / chat-completions adapters", () => {
  it("prefers search_results over bare citations", async () => {
    const r = await new PerplexitySearchAdapter("k", "sonar", async () =>
      json({ choices: [{ message: { content: "x" } }], citations: ["https://old.com"], search_results: [{ url: "https://new.com/p", title: "New" }] }),
    ).collect("q");
    expect(r.citations).toEqual([{ url: "https://new.com/p", title: "New" }]);
  });

  it("uses Gemini grounding titles as the source domain for redirect links", async () => {
    const r = await new GeminiSearchAdapter("k", "g", async () =>
      json({ candidates: [{ content: { parts: [{ text: "hi" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "www.G2.com" } }] } }] }),
    ).collect("q");
    expect(r.citations[0]).toMatchObject({ domain: "g2.com" });
  });

  it("uses the xAI Responses API with web_search (no deprecated live search) and drops ordinal titles", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = async (u: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(u), body: JSON.parse(String(init?.body)) });
      return json({ output: [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", url: "https://x.ai/", title: "1" }] }] }], citations: ["https://x.ai/", "https://w.org/"] });
    };
    const r = await new XaiSearchAdapter("k", "grok-4.7", fetchImpl).collect("q", { country: "US" });
    expect(calls[0].url).toBe("https://api.x.ai/v1/responses");
    expect(calls[0].body).toEqual({ model: "grok-4.7", input: "q", tools: [{ type: "web_search" }] });
    expect(calls[0].body).not.toHaveProperty("search_parameters");
    expect(r.citations).toEqual([{ url: "https://x.ai/", title: undefined }, { url: "https://w.org/" }]);
    await new ChatCompletionsAdapter("deepseek", "DeepSeek", { provider: "deepseek", baseUrl: "https://d", apiKey: "k", modelId: "m", fetchImpl }).collect("q");
    expect(calls[1].url).toBe("https://d/chat/completions");
  });
});

describe("Anthropic adapter", () => {
  function stub(responses: Record<string, unknown>[]) {
    const create = vi.fn(async (_p: unknown) => responses.shift());
    return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
  }
  const usage = { input_tokens: 5, output_tokens: 7 };

  it("resumes pause_turn, collects text + web citations, and sums usage", async () => {
    const { client, create } = stub([
      { stop_reason: "pause_turn", usage, content: [{ type: "text", text: "Part one. ", citations: [{ type: "web_search_result_location", url: "https://a.com", title: "A" }] }] },
      { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Part two.", citations: null }] },
    ]);
    const r = await new AnthropicSearchAdapter(client).collect("best tools", { country: "US" });
    expect(r.text).toBe("Part one. Part two.");
    expect(r.citations).toEqual([{ url: "https://a.com", title: "A" }]);
    expect(r.tokensIn).toBe(10);
    const first = create.mock.calls[0][0] as { model: string; tools: { type: string; user_location?: unknown }[]; betas: string[]; fallbacks: string };
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.tools[0]).toMatchObject({ type: "web_search_20260209", user_location: { type: "approximate", country: "US" } });
    expect(first.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(first.fallbacks).toBe("default");
    const second = create.mock.calls[1][0] as { messages: { role: string }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("treats a refusal as a failed item", async () => {
    const { client } = stub([{ stop_reason: "refusal", usage, content: [] }]);
    await expect(new AnthropicSearchAdapter(client).collect("x")).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("registry", () => {
  it("only lists models with credentials; simulated only in non-production with the flag", () => {
    expect(configuredAdapters({}).map((a) => a.model)).toEqual([]);
    expect(configuredAdapters({ PERPLEXITY_API_KEY: "p", DEEPSEEK_API_KEY: "d" }).map((a) => a.model)).toEqual(["perplexity", "deepseek"]);
    expect(simulatedEnabled({ LLM_SIMULATED_PROVIDER: "true", NODE_ENV: "production" })).toBe(false);
    expect(configuredAdapters({ LLM_SIMULATED_PROVIDER: "true", NODE_ENV: "development" }).map((a) => a.model)).toEqual(["simulated"]);
  });
});
