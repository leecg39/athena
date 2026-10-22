/** Gemini surface: generateContent with Google Search grounding. */
import { postJson, uniqueCitations, type CollectedAnswer, type CollectOptions, type FetchLike, type SearchAdapter } from "./types";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiSearchAdapter implements SearchAdapter {
  readonly model = "gemini" as const;
  readonly label = "Gemini";

  constructor(
    private readonly apiKey: string,
    private readonly modelId = process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async collect(prompt: string, _opts: CollectOptions = {}): Promise<CollectedAnswer> {
    const data = await postJson<GeminiResponse>(
      "gemini",
      this.fetchImpl,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelId)}:generateContent`,
      { "x-goog-api-key": this.apiKey },
      { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }] },
    );
    const cand = data.candidates?.[0];
    const citations = (cand?.groundingMetadata?.groundingChunks ?? [])
      .filter((c) => c.web?.uri)
      .map((c) => {
        // grounding URIs are Google redirect links; the title carries the source domain
        const title = c.web?.title;
        const domain = title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title) ? title.toLowerCase().replace(/^www\./, "") : undefined;
        return { url: c.web!.uri!, title, domain };
      });
    return {
      text: (cand?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
      citations: uniqueCitations(citations),
      provider: `gemini:${this.modelId}`,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
