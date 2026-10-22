/** AI-search answer collection: provider adapter contract. */
export type CollectableModel = "chatgpt" | "claude" | "perplexity" | "gemini" | "grok" | "deepseek" | "simulated";

export interface AnswerCitation {
  url: string;
  title?: string;
  /** hostname override when the URL is a redirect (e.g. Gemini grounding links) */
  domain?: string;
}

export interface CollectedAnswer {
  text: string;
  citations: AnswerCitation[];
  /** concrete provider:model that produced the answer */
  provider: string;
  tokensIn: number;
  tokensOut: number;
  simulated?: boolean;
}

export interface CollectOptions {
  /** ISO 3166-1 alpha-2 market the answer should reflect */
  country?: string;
  /** brand/competitor names (only used by the simulated provider) */
  entities?: string[];
}

export interface SearchAdapter {
  readonly model: CollectableModel;
  readonly label: string;
  collect(prompt: string, opts?: CollectOptions): Promise<CollectedAnswer>;
}

export type Env = Record<string, string | undefined>;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

export const COLLECT_TIMEOUT_MS = 120_000;

/** POST JSON and parse, mapping HTTP failures to ProviderError (no bodies leaked to users). */
export async function postJson<T>(provider: string, fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(COLLECT_TIMEOUT_MS),
  });
  if (!res.ok) throw new ProviderError(provider, `request failed with status ${res.status}`, res.status);
  return (await res.json()) as T;
}

export function uniqueCitations(list: AnswerCitation[]): AnswerCitation[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    if (!c.url || seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}
