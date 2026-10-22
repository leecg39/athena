/**
 * Structured generation for OpenAI-compatible chat APIs (OpenAI, xAI, DeepSeek):
 * JSON mode + the JSON Schema in the system prompt, validated with zod.
 */
import * as z from "zod/v4";
import { AssistError, type AssistProvider, type StructuredRequest } from "./types";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function schemaInstruction(schema: z.ZodType): string {
  return `Respond with a single JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;
}

export function validateJson<T>(raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AssistError("The model returned invalid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new AssistError(`The model output does not match the schema: ${result.error.issues[0]?.message ?? "invalid"}`);
  return result.data;
}

export class OpenAICompatibleAssist implements AssistProvider {
  readonly id: string;
  private readonly cfg: Required<OpenAICompatibleConfig>;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.cfg = { fetchImpl: fetch, timeoutMs: 60_000, ...cfg };
  }

  async generate<T>(req: StructuredRequest<T>): Promise<T> {
    const res = await this.cfg.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: req.maxTokens ?? 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${req.system}\n\n${schemaInstruction(req.schema)}` },
          { role: "user", content: req.prompt },
        ],
      }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (!res.ok) throw new AssistError(`${this.id} request failed with status ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new AssistError(`${this.id} returned an empty response`);
    return validateJson(content, req.schema);
  }
}
