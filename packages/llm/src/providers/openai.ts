/**
 * Responses-API search adapter (OpenAI for ChatGPT, xAI for Grok): the built-in
 * `web_search` tool; sources come back as `url_citation` annotations.
 */
import { postJson, uniqueCitations, type AnswerCitation, type CollectableModel, type CollectedAnswer, type CollectOptions, type FetchLike, type SearchAdapter } from "./types";

interface ResponsesOutput {
  output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[];
  citations?: string[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface ResponsesAdapterConfig {
  provider: "openai" | "xai";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** whether the provider's web_search tool accepts an approximate user_location */
  supportsLocation: boolean;
  fetchImpl?: FetchLike;
}

export class ResponsesSearchAdapter implements SearchAdapter {
  constructor(
    readonly model: CollectableModel,
    readonly label: string,
    private readonly cfg: ResponsesAdapterConfig,
  ) {}

  async collect(prompt: string, opts: CollectOptions = {}): Promise<CollectedAnswer> {
    const tool = { type: "web_search", ...(this.cfg.supportsLocation && opts.country ? { user_location: { type: "approximate", country: opts.country } } : {}) };
    const data = await postJson<ResponsesOutput>(this.cfg.provider, this.cfg.fetchImpl ?? fetch, `${this.cfg.baseUrl}/responses`, { Authorization: `Bearer ${this.cfg.apiKey}` }, {
      model: this.cfg.modelId,
      input: prompt,
      tools: [tool],
    });
    let text = "";
    const citations: AnswerCitation[] = [];
    for (const item of data.output ?? []) {
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        text += part.text ?? "";
        for (const a of part.annotations ?? []) {
          // some providers use ordinal titles ("1", "2") — those carry no information
          if (a.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title && !/^\d+$/.test(a.title) ? a.title : undefined });
        }
      }
    }
    for (const url of data.citations ?? []) citations.push({ url });
    return {
      text,
      citations: uniqueCitations(citations),
      provider: `${this.cfg.provider}:${this.cfg.modelId}`,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
    };
  }
}

/** ChatGPT surface (OpenAI). */
export class OpenAiSearchAdapter extends ResponsesSearchAdapter {
  constructor(apiKey: string, modelId = process.env.OPENAI_SEARCH_MODEL ?? "gpt-4.1", fetchImpl?: FetchLike) {
    super("chatgpt", "ChatGPT", { provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey, modelId, supportsLocation: true, fetchImpl });
  }
}

/** Grok surface (xAI Agent Tools API — replaces the deprecated Live Search). */
export class XaiSearchAdapter extends ResponsesSearchAdapter {
  constructor(apiKey: string, modelId = process.env.XAI_SEARCH_MODEL ?? "grok-4.7", fetchImpl?: FetchLike) {
    super("grok", "Grok", { provider: "xai", baseUrl: "https://api.x.ai/v1", apiKey, modelId, supportsLocation: false, fetchImpl });
  }
}
