/**
 * LLM provider adapters for AI-search response collection.
 *
 * Each adapter runs a tracked prompt against one provider in its
 * web-search / grounding mode so responses mirror what users see in
 * real AI search surfaces. Adapters are key-optional: when an API key
 * is missing the MockProvider is used so the pipeline works end-to-end.
 */
export interface CollectedResponse {
  rawText: string;
  /** citations extracted from the provider response (url list) */
  citations: string[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  mock?: boolean;
}

export interface SearchProvider {
  readonly id: string;
  readonly model: string;
  /** true when a real API key is configured */
  readonly live: boolean;
  collect(prompt: string): Promise<CollectedResponse>;
}

/* ------------------------------------------------------------------ */
/* Mock provider                                                       */
/* ------------------------------------------------------------------ */

export class MockProvider implements SearchProvider {
  constructor(
    readonly id: string,
    readonly model: string,
  ) {}
  get live(): boolean {
    return false;
  }

  async collect(prompt: string): Promise<CollectedResponse> {
    const domains = ["reddit.com", "youtube.com", "medium.com", "g2.com", "linkedin.com"];
    const n = prompt.length % domains.length;
    const picks = [domains[n], domains[(n + 2) % domains.length], domains[(n + 4) % domains.length]];
    const brand = /canvasly/i.test(prompt) ? "Canvasly" : "Canvasly";
    const mentioned = (prompt.length + this.id.length) % 10 < 7;
    const text = [
      `Here is a synthesized answer for "${prompt}".`,
      "",
      mentioned
        ? `${brand} stands out as a top choice for product teams thanks to its AI-first workflow, realtime collaboration, and generous free tier.`
        : `Popular options include tools from established vendors in this category.`,
      "",
      `Sources:`,
      ...picks.map((d) => `- [${d}](https://www.${d}/best-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)})`),
    ].join("\n");
    return {
      rawText: text,
      citations: picks.map((d) => `https://www.${d}/`),
      provider: this.id,
      model: this.model,
      tokensIn: prompt.length,
      tokensOut: text.length,
      mock: true,
    };
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI (Responses API + web search) — ChatGPT surface               */
/* ------------------------------------------------------------------ */

export class OpenAiSearchProvider implements SearchProvider {
  readonly id = "chatgpt";
  readonly model = "gpt-4o-search-preview";
  readonly live: boolean;

  constructor(private readonly apiKey = process.env.OPENAI_API_KEY) {
    this.live = Boolean(apiKey);
  }

  async collect(prompt: string): Promise<CollectedResponse> {
    if (!this.apiKey) return new MockProvider(this.id, this.model).collect(prompt);
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        tools: [{ type: "web_search_preview" }],
        input: prompt,
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      output: {
        type: string;
        content?: { type: string; text?: string; annotations?: { url_citation?: { url: string } }[] }[];
      }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    let text = "";
    const citations: string[] = [];
    for (const item of data.output ?? []) {
      for (const c of item.content ?? []) {
        if (c.text) text += c.text;
        for (const a of c.annotations ?? []) {
          if (a.url_citation?.url) citations.push(a.url_citation.url);
        }
      }
    }
    return {
      rawText: text,
      citations: [...new Set(citations)],
      provider: this.id,
      model: this.model,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Perplexity (Sonar)                                                  */
/* ------------------------------------------------------------------ */

export class PerplexityProvider implements SearchProvider {
  readonly id = "perplexity";
  readonly model = "sonar";
  readonly live: boolean;

  constructor(private readonly apiKey = process.env.PERPLEXITY_API_KEY) {
    this.live = Boolean(apiKey);
  }

  async collect(prompt: string): Promise<CollectedResponse> {
    if (!this.apiKey) return new MockProvider(this.id, this.model).collect(prompt);
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`perplexity ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      citations?: string[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      rawText: data.choices?.[0]?.message?.content ?? "",
      citations: data.citations ?? [],
      provider: this.id,
      model: this.model,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic (Claude + web search tool)                                */
/* ------------------------------------------------------------------ */

export class AnthropicProvider implements SearchProvider {
  readonly id = "claude";
  readonly model = "claude-3-5-sonnet-latest";
  readonly live: boolean;

  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY) {
    this.live = Boolean(apiKey);
  }

  async collect(prompt: string): Promise<CollectedResponse> {
    if (!this.apiKey) return new MockProvider(this.id, this.model).collect(prompt);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    return {
      rawText: text,
      citations: [],
      provider: this.id,
      model: this.model,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Google Gemini (grounding with Google Search)                        */
/* ------------------------------------------------------------------ */

export class GeminiProvider implements SearchProvider {
  readonly id = "gemini";
  readonly model = "gemini-2.0-flash";
  readonly live: boolean;

  constructor(private readonly apiKey = process.env.GEMINI_API_KEY) {
    this.live = Boolean(apiKey);
  }

  async collect(prompt: string): Promise<CollectedResponse> {
    if (!this.apiKey) return new MockProvider(this.id, this.model).collect(prompt);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      candidates: {
        content: { parts: { text?: string }[] };
        groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] };
      }[];
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("\n");
    const citations = (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web?.uri)
      .filter((u): u is string => Boolean(u));
    return {
      rawText: text,
      citations,
      provider: this.id,
      model: this.model,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* xAI Grok                                                            */
/* ------------------------------------------------------------------ */

export class XaiProvider implements SearchProvider {
  readonly id = "grok";
  readonly model = "grok-2-latest";
  readonly live: boolean;

  constructor(private readonly apiKey = process.env.XAI_API_KEY) {
    this.live = Boolean(apiKey);
  }

  async collect(prompt: string): Promise<CollectedResponse> {
    if (!this.apiKey) return new MockProvider(this.id, this.model).collect(prompt);
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`xai ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      rawText: data.choices?.[0]?.message?.content ?? "",
      citations: [],
      provider: this.id,
      model: this.model,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* DeepSeek                                                            */
/* ------------------------------------------------------------------ */

export class DeepSeekProvider implements SearchProvider {
  readonly id = "deepseek";
  readonly model = "deepseek-chat";
  readonly live: boolean;

  constructor(private readonly apiKey = process.env.DEEPSEEK_API_KEY) {
    this.live = Boolean(apiKey);
  }

  async collect(prompt: string): Promise<CollectedResponse> {
    if (!this.apiKey) return new MockProvider(this.id, this.model).collect(prompt);
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`deepseek ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      rawText: data.choices?.[0]?.message?.content ?? "",
      citations: [],
      provider: this.id,
      model: this.model,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export function allProviders(): SearchProvider[] {
  return [
    new OpenAiSearchProvider(),
    new PerplexityProvider(),
    new AnthropicProvider(),
    new GeminiProvider(),
    new XaiProvider(),
    new DeepSeekProvider(),
  ];
}

export function providerFor(model: string): SearchProvider {
  const found = allProviders().find((p) => p.id === model);
  return found ?? new MockProvider(model, model);
}
