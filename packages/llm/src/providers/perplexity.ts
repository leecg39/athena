/** Perplexity surface: Sonar chat completions (search-grounded, returns sources). */
import { postJson, uniqueCitations, type CollectedAnswer, type CollectOptions, type FetchLike, type SearchAdapter } from "./types";

interface SonarResponse {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string; title?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class PerplexitySearchAdapter implements SearchAdapter {
  readonly model = "perplexity" as const;
  readonly label = "Perplexity";

  constructor(
    private readonly apiKey: string,
    private readonly modelId = process.env.PERPLEXITY_MODEL ?? "sonar",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async collect(prompt: string, opts: CollectOptions = {}): Promise<CollectedAnswer> {
    const data = await postJson<SonarResponse>("perplexity", this.fetchImpl, "https://api.perplexity.ai/chat/completions", { Authorization: `Bearer ${this.apiKey}` }, {
      model: this.modelId,
      messages: [{ role: "user", content: prompt }],
      ...(opts.country ? { web_search_options: { user_location: { country: opts.country } } } : {}),
    });
    const fromResults = (data.search_results ?? []).filter((r) => r.url).map((r) => ({ url: r.url!, title: r.title }));
    const fromCitations = (data.citations ?? []).map((url) => ({ url }));
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      citations: uniqueCitations(fromResults.length ? fromResults : fromCitations),
      provider: `perplexity:${this.modelId}`,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}
