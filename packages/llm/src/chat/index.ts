import { simulatedEnabled } from "../providers";
import { AnthropicChat } from "./anthropic";
import { OpenAICompatibleChat } from "./openai-compatible";
import { SimulatedChat } from "./simulated";
import { ChatError, ChatUnavailableError, type ChatEvent, type ChatOutcome, type ChatProvider, type ChatRequest } from "./types";

export * from "./types";
export { AnthropicChat, CLAUDE_CHAT_MODEL } from "./anthropic";
export { OpenAICompatibleChat } from "./openai-compatible";
export { SimulatedChat } from "./simulated";
export { toolErrorMessage } from "./tool-runner";

type Env = Record<string, string | undefined>;

/** Chat providers in preference order, limited to those with credentials. */
export function availableChatProviders(env: Env = process.env): ChatProvider[] {
  const list: ChatProvider[] = [];
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) list.push(new AnthropicChat());
  if (env.OPENAI_API_KEY) list.push(new OpenAICompatibleChat({ id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY, model: env.OPENAI_CHAT_MODEL ?? "gpt-4.1" }));
  if (env.XAI_API_KEY) list.push(new OpenAICompatibleChat({ id: "xai", baseUrl: "https://api.x.ai/v1", apiKey: env.XAI_API_KEY, model: env.XAI_CHAT_MODEL ?? env.XAI_MODEL ?? "grok-3-mini" }));
  if (env.DEEPSEEK_API_KEY) list.push(new OpenAICompatibleChat({ id: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL ?? "deepseek-chat" }));
  if (simulatedEnabled(env)) list.push(new SimulatedChat());
  return list;
}

/**
 * Answers with the first provider that works. Falls back to the next one only
 * while nothing has been emitted, so the user never sees duplicated output.
 */
export async function runChat(
  req: ChatRequest,
  emit: (e: ChatEvent) => void,
  providers: ChatProvider[] = availableChatProviders(),
): Promise<ChatOutcome & { provider: string; simulated: boolean }> {
  if (!providers.length) throw new ChatUnavailableError();
  let lastError: unknown = null;
  for (const provider of providers) {
    let emitted = false;
    emit({ type: "provider", id: provider.id, simulated: provider.simulated });
    try {
      const out = await provider.chat(req, (e) => {
        emitted = true;
        emit(e);
      });
      return { ...out, provider: provider.id, simulated: provider.simulated };
    } catch (err) {
      if (req.signal?.aborted || emitted) throw err;
      lastError = err;
      console.warn("[chat] provider failed before answering, trying the next one", provider.id, err instanceof Error ? err.message : err);
    }
  }
  throw lastError instanceof Error ? lastError : new ChatError("Every AI provider failed");
}
