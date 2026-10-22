/**
 * Claude structured generation via the official Anthropic SDK:
 * `beta.messages.parse` + `zodOutputFormat`, with server-side fallback on refusal.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AssistError, type AssistProvider, type StructuredRequest } from "./types";

export const CLAUDE_ASSIST_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

export class AnthropicAssist implements AssistProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async generate<T>(req: StructuredRequest<T>): Promise<T> {
    const response = await this.client.beta.messages.parse({
      model: CLAUDE_ASSIST_MODEL,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      // short, well-specified extraction/suggestion tasks: low effort is enough
      output_config: { effort: "low", format: zodOutputFormat(req.schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw new AssistError("The model declined this request");
    if (response.stop_reason === "max_tokens") throw new AssistError("The model response was truncated");
    if (response.parsed_output == null) throw new AssistError("The model returned output that does not match the schema");
    return response.parsed_output as T;
  }
}
