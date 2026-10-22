/** Structured generation with Google Gemini (JSON response MIME type), validated with zod. */
import { AssistError, type AssistProvider, type StructuredRequest } from "./types";
import { schemaInstruction, validateJson } from "./openai-compatible";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GeminiAssist implements AssistProvider {
  readonly id = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async generate<T>(req: StructuredRequest<T>): Promise<T> {
    const res = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${req.system}\n\n${schemaInstruction(req.schema)}` }] },
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: req.maxTokens ?? 4000 },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) throw new AssistError(`gemini request failed with status ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new AssistError("gemini returned an empty response");
    return validateJson(text, req.schema);
  }
}
