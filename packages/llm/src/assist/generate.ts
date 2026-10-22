/**
 * Provider-agnostic structured generation used for onboarding suggestions,
 * insights and other assistant features. Providers are chosen from the
 * configured API keys; with none configured callers get `unavailable` and
 * must not substitute fabricated data.
 */
import { AnthropicAssist } from "./anthropic";
import { OpenAICompatibleAssist } from "./openai-compatible";
import { GeminiAssist } from "./gemini";
import type { AssistProvider, StructuredRequest } from "./types";

export type StructuredResult<T> =
  | { ok: true; data: T; provider: string }
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "failed"; error: string };

type Env = Record<string, string | undefined>;

/** Providers in preference order, limited to those with credentials. */
export function availableAssistProviders(env: Env = process.env): AssistProvider[] {
  const list: AssistProvider[] = [];
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) list.push(new AnthropicAssist());
  if (env.OPENAI_API_KEY) {
    list.push(new OpenAICompatibleAssist({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL ?? "gpt-4.1-mini" }));
  }
  if (env.GEMINI_API_KEY) list.push(new GeminiAssist(env.GEMINI_API_KEY));
  if (env.XAI_API_KEY) {
    list.push(new OpenAICompatibleAssist({ id: "xai", baseUrl: "https://api.x.ai/v1", apiKey: env.XAI_API_KEY, model: env.XAI_MODEL ?? "grok-3-mini" }));
  }
  if (env.DEEPSEEK_API_KEY) {
    list.push(new OpenAICompatibleAssist({ id: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL ?? "deepseek-chat" }));
  }
  return list;
}

export async function generateStructured<T>(
  req: StructuredRequest<T>,
  providers: AssistProvider[] = availableAssistProviders(),
): Promise<StructuredResult<T>> {
  if (!providers.length) return { ok: false, reason: "unavailable" };
  let lastError = "unknown error";
  for (const provider of providers) {
    try {
      return { ok: true, data: await provider.generate(req), provider: provider.id };
    } catch (err) {
      lastError = `${provider.id}: ${err instanceof Error ? err.message : String(err)}`;
      console.warn("[assist] provider failed, trying next", lastError);
    }
  }
  return { ok: false, reason: "failed", error: lastError };
}
