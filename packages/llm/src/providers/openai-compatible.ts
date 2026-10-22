/** DeepSeek via chat completions (no web search: sources only from links in the answer text). */
import { postJson, type CollectableModel, type CollectedAnswer, type FetchLike, type SearchAdapter } from "./types";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class ChatCompletionsAdapter implements SearchAdapter {
  constructor(
    readonly model: CollectableModel,
    readonly label: string,
    private readonly cfg: { provider: string; baseUrl: string; apiKey: string; modelId: string; fetchImpl?: FetchLike },
  ) {}

  async collect(prompt: string): Promise<CollectedAnswer> {
    const data = await postJson<ChatResponse>(this.cfg.provider, this.cfg.fetchImpl ?? fetch, `${this.cfg.baseUrl}/chat/completions`, { Authorization: `Bearer ${this.cfg.apiKey}` }, {
      model: this.cfg.modelId,
      messages: [{ role: "user", content: prompt }],
    });
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      citations: [],
      provider: `${this.cfg.provider}:${this.cfg.modelId}`,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}
