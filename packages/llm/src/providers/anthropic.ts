/**
 * Claude surface via the official Anthropic SDK: claude-opus-5-5 with the
 * web_search_20260209 server tool, resuming `pause_turn`, server-side fallback on refusal.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, uniqueCitations, type AnswerCitation, type CollectedAnswer, type CollectOptions, type SearchAdapter } from "./types";

export const CLAUDE_COLLECT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const MAX_CONTINUATIONS = 3;

export class AnthropicSearchAdapter implements SearchAdapter {
  readonly model = "claude" as const;
  readonly label = "Claude";
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ timeout: 180_000 });
  }

  async collect(prompt: string, opts: CollectOptions = {}): Promise<CollectedAnswer> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
    const tool: Anthropic.Beta.BetaWebSearchTool20260209 = {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 5,
      ...(opts.country ? { user_location: { type: "approximate", country: opts.country } } : {}),
    };
    let text = "";
    const citations: AnswerCitation[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const res = await this.client.beta.messages.create({
        model: CLAUDE_COLLECT_MODEL,
        max_tokens: 16000,
        tools: [tool],
        messages,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      tokensIn += res.usage.input_tokens;
      tokensOut += res.usage.output_tokens;
      if (res.stop_reason === "refusal") throw new ProviderError("anthropic", "the model declined this prompt");
      for (const block of res.content) {
        if (block.type !== "text") continue;
        text += block.text;
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") citations.push({ url: c.url, title: c.title ?? undefined });
        }
      }
      if (res.stop_reason !== "pause_turn") break;
      // long-running server tool turn: send the paused turn back to resume
      messages.push({ role: "assistant", content: res.content });
    }
    return { text, citations: uniqueCitations(citations), provider: `anthropic:${CLAUDE_COLLECT_MODEL}`, tokensIn, tokensOut };
  }
}
