/** Registry of collectable AI models: only those with credentials (no silent fakes). */
import { OpenAiSearchAdapter, XaiSearchAdapter, ResponsesSearchAdapter } from "./openai";
import { AnthropicSearchAdapter } from "./anthropic";
import { PerplexitySearchAdapter } from "./perplexity";
import { GeminiSearchAdapter } from "./gemini";
import { ChatCompletionsAdapter } from "./openai-compatible";
import { SimulatedAdapter } from "./simulated";
import type { CollectableModel, Env, SearchAdapter } from "./types";

export * from "./types";
export { OpenAiSearchAdapter, XaiSearchAdapter, ResponsesSearchAdapter, AnthropicSearchAdapter, PerplexitySearchAdapter, GeminiSearchAdapter, ChatCompletionsAdapter, SimulatedAdapter };

/** The simulated provider is allowed only outside production and only when explicitly enabled. */
export function simulatedEnabled(env: Env = process.env): boolean {
  return env.LLM_SIMULATED_PROVIDER === "true" && env.NODE_ENV !== "production";
}

export function configuredAdapters(env: Env = process.env): SearchAdapter[] {
  const list: SearchAdapter[] = [];
  if (env.OPENAI_API_KEY) list.push(new OpenAiSearchAdapter(env.OPENAI_API_KEY, env.OPENAI_SEARCH_MODEL ?? "gpt-4.1"));
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) list.push(new AnthropicSearchAdapter());
  if (env.PERPLEXITY_API_KEY) list.push(new PerplexitySearchAdapter(env.PERPLEXITY_API_KEY, env.PERPLEXITY_MODEL ?? "sonar"));
  if (env.GEMINI_API_KEY) list.push(new GeminiSearchAdapter(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? "gemini-2.5-flash"));
  if (env.XAI_API_KEY) {
    list.push(new XaiSearchAdapter(env.XAI_API_KEY, env.XAI_SEARCH_MODEL ?? "grok-4.7"));
  }
  if (env.DEEPSEEK_API_KEY) {
    list.push(new ChatCompletionsAdapter("deepseek", "DeepSeek", { provider: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: env.DEEPSEEK_API_KEY, modelId: env.DEEPSEEK_MODEL ?? "deepseek-chat" }));
  }
  if (simulatedEnabled(env)) list.push(new SimulatedAdapter());
  return list;
}

export function adapterFor(model: string, env: Env = process.env): SearchAdapter | null {
  return configuredAdapters(env).find((a) => a.model === model) ?? null;
}

export const COLLECTABLE_MODELS: readonly CollectableModel[] = ["chatgpt", "claude", "perplexity", "gemini", "grok", "deepseek"];
