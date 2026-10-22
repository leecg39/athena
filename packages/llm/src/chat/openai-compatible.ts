/**
 * Function-calling chat for OpenAI-compatible Chat Completions APIs (OpenAI,
 * xAI, DeepSeek). Each round is a plain request; the final answer is emitted
 * in small deltas.
 */
import { chunks, runTool } from "./tool-runner";
import { ChatError, DEFAULT_MAX_STEPS, type ChatEvent, type ChatOutcome, type ChatProvider, type ChatRequest, type ToolCallSummary } from "./types";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface Choice {
  finish_reason?: string;
  message?: { content?: string | null; tool_calls?: ToolCall[] };
}

export interface OpenAICompatibleChatConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw || "{}") };
  } catch {
    return { ok: false };
  }
}

export class OpenAICompatibleChat implements ChatProvider {
  readonly id: string;
  readonly simulated = false;
  private readonly cfg: Required<OpenAICompatibleChatConfig>;

  constructor(cfg: OpenAICompatibleChatConfig) {
    this.id = cfg.id;
    this.cfg = { fetchImpl: fetch, timeoutMs: 90_000, ...cfg };
  }

  private async complete(messages: WireMessage[], req: ChatRequest): Promise<Choice> {
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    const tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const res = await this.cfg.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.cfg.model, max_tokens: 4000, messages, ...(tools.length ? { tools } : {}) }),
      signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
    });
    if (!res.ok) throw new ChatError(`${this.id} request failed with status ${res.status}`);
    const choice = ((await res.json()) as { choices?: Choice[] }).choices?.[0];
    if (!choice?.message) throw new ChatError(`${this.id} returned no answer`);
    return choice;
  }

  async chat(req: ChatRequest, emit: (e: ChatEvent) => void): Promise<ChatOutcome> {
    let messages: WireMessage[] = [{ role: "system", content: req.system }, ...req.turns.map((t) => ({ role: t.role, content: t.content }))];
    let toolCalls: ToolCallSummary[] = [];
    for (let step = 0; step <= (req.maxSteps ?? DEFAULT_MAX_STEPS); step++) {
      const choice = await this.complete(messages, req);
      const calls = choice.message?.tool_calls ?? [];
      if (!calls.length) {
        const text = choice.message?.content ?? "";
        chunks(text).forEach((delta) => emit({ type: "text", delta }));
        const finish = choice.finish_reason === "content_filter" ? "refused" : choice.finish_reason === "length" ? "truncated" : "end";
        return { text, toolCalls, finish };
      }
      const results: WireMessage[] = [];
      for (const call of calls) {
        const input = parseArgs(call.function.arguments);
        const r = input.ok ? await runTool(req.tools, call.function.name, input.value, emit) : { ok: false, content: "Invalid input: the arguments were not valid JSON" };
        toolCalls = [...toolCalls, { name: call.function.name, ok: r.ok }];
        results.push({ role: "tool", tool_call_id: call.id, content: r.content });
      }
      messages = [...messages, { role: "assistant", content: choice.message?.content ?? null, tool_calls: calls }, ...results];
    }
    return { text: "", toolCalls, finish: "truncated" };
  }
}
