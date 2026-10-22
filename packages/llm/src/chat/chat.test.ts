import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicChat } from "./anthropic";
import { OpenAICompatibleChat } from "./openai-compatible";
import { SimulatedChat } from "./simulated";
import { availableChatProviders, runChat, ChatUnavailableError } from "./index";
import type { ChatEvent, ChatProvider, ChatTool } from "./types";

const metricsTool: ChatTool = {
  name: "get_visibility_metrics",
  description: "metrics",
  inputSchema: { type: "object", properties: { days: { type: "integer" } } },
  run: vi.fn(async (input: unknown) => ({ days: z.object({ days: z.number().int().min(7) }).parse(input).days, mentionRate: 50, answers: 4 })),
};

/** Minimal stand-in for client.messages.stream(): scripted turns. */
function fakeClient(turns: { text?: string; message: Partial<Anthropic.Message> }[]) {
  const calls: { body: Anthropic.MessageCreateParams; options?: { signal?: AbortSignal | null } }[] = [];
  const client = {
    messages: {
      stream: (body: Anthropic.MessageCreateParams, options?: { signal?: AbortSignal | null }) => {
        calls.push({ body: structuredClone(body), options });
        const turn = turns[calls.length - 1];
        let onText: ((d: string) => void) | undefined;
        return {
          on: (event: string, cb: (d: string) => void) => {
            if (event === "text") onText = cb;
          },
          finalMessage: async () => {
            if (turn.text) onText?.(turn.text);
            return { role: "assistant", type: "message", ...turn.message } as Anthropic.Message;
          },
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const collect = () => {
  const events: ChatEvent[] = [];
  return { events, emit: (e: ChatEvent) => events.push(e) };
};

describe("AnthropicChat", () => {
  it("runs the tool loop with the official SDK stream and returns the streamed text", async () => {
    const { client, calls } = fakeClient([
      { text: "Checking. ", message: { stop_reason: "tool_use", content: [{ type: "text", text: "Checking. " } as Anthropic.TextBlock, { type: "tool_use", id: "tu1", name: "get_visibility_metrics", input: { days: 30 } } as Anthropic.ToolUseBlock] } },
      { text: "Mention rate is 50%.", message: { stop_reason: "end_turn", content: [{ type: "text", text: "Mention rate is 50%." } as Anthropic.TextBlock] } },
    ]);
    const ac = new AbortController();
    const { events, emit } = collect();
    const out = await new AnthropicChat(client, "claude-opus-5-5").chat({ system: "sys", turns: [{ role: "user", content: "How am I doing?" }], tools: [metricsTool], signal: ac.signal }, emit);
    expect(out).toEqual({ text: "Checking. \n\nMention rate is 50%.", toolCalls: [{ name: "get_visibility_metrics", ok: true }], finish: "end" });
    expect(events.map((e) => (e.type === "text" ? `t:${e.delta}` : e.type === "tool" ? `${e.name}:${e.status}` : e.type))).toEqual(["t:Checking. ", "get_visibility_metrics:running", "get_visibility_metrics:done", "t:\n\n", "t:Mention rate is 50%."]);
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5-5", system: "sys", tools: [{ name: "get_visibility_metrics", input_schema: { type: "object" } }] });
    expect(calls[0].body).not.toHaveProperty("thinking");
    expect(calls[0].options?.signal).toBe(ac.signal);
    const second = calls[1].body.messages;
    expect(second[1]).toMatchObject({ role: "assistant" });
    expect(second[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false }] });
    expect(JSON.parse((second[2].content as Anthropic.ToolResultBlockParam[])[0].content as string)).toMatchObject({ mentionRate: 50 });
  });

  it("reports invalid tool input back to the model as an error result", async () => {
    const { client, calls } = fakeClient([
      { message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "get_visibility_metrics", input: { days: 2 } } as Anthropic.ToolUseBlock] } },
      { text: "Sorry.", message: { stop_reason: "end_turn", content: [] } },
    ]);
    const out = await new AnthropicChat(client).chat({ system: "s", turns: [{ role: "user", content: "x" }], tools: [metricsTool] }, collect().emit);
    expect(out.toolCalls).toEqual([{ name: "get_visibility_metrics", ok: false }]);
    const result = (calls[1].body.messages[2].content as Anthropic.ToolResultBlockParam[])[0];
    expect(result).toMatchObject({ is_error: true });
    expect(String(result.content)).toMatch(/invalid input/i);
  });

  it("stops on refusal and after the step limit", async () => {
    const refused = fakeClient([{ text: "I can't help with that.", message: { stop_reason: "refusal", content: [] } }]);
    expect((await new AnthropicChat(refused.client).chat({ system: "s", turns: [{ role: "user", content: "x" }], tools: [] }, collect().emit)).finish).toBe("refused");
    const loop = { stop_reason: "tool_use" as const, content: [{ type: "tool_use", id: "t", name: "get_visibility_metrics", input: { days: 30 } } as Anthropic.ToolUseBlock] };
    const looping = fakeClient(Array.from({ length: 10 }, () => ({ message: loop })));
    const out = await new AnthropicChat(looping.client).chat({ system: "s", turns: [{ role: "user", content: "x" }], tools: [metricsTool], maxSteps: 2 }, collect().emit);
    expect(out.finish).toBe("truncated");
    expect(looping.calls).toHaveLength(3);
  });
});

describe("OpenAICompatibleChat", () => {
  it("runs function calls and emits the final answer", async () => {
    const bodies: Record<string, any>[] = [];
    const replies = [
      { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_visibility_metrics", arguments: '{"days":30}' } }, { id: "c2", type: "function", function: { name: "get_visibility_metrics", arguments: "{bad json" } }] } }] },
      { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Mention rate is 50%." } }] },
    ];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(replies[bodies.length - 1]), { status: 200 });
    });
    const { events, emit } = collect();
    const chat = new OpenAICompatibleChat({ id: "openai", baseUrl: "https://api.test/v1", apiKey: "k", model: "gpt-test", fetchImpl });
    const out = await chat.chat({ system: "sys", turns: [{ role: "user", content: "How am I doing?" }], tools: [metricsTool] }, emit);
    expect(out).toEqual({ text: "Mention rate is 50%.", toolCalls: [{ name: "get_visibility_metrics", ok: true }, { name: "get_visibility_metrics", ok: false }], finish: "end" });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("Mention rate is 50%.");
    expect(bodies[0]).toMatchObject({ model: "gpt-test", messages: [{ role: "system", content: "sys" }, { role: "user" }], tools: [{ type: "function", function: { name: "get_visibility_metrics", parameters: { type: "object" } } }] });
    expect(bodies[1].messages.slice(-2)).toMatchObject([{ role: "tool", tool_call_id: "c1" }, { role: "tool", tool_call_id: "c2", content: expect.stringMatching(/invalid/i) }]);
  });

  it("surfaces HTTP failures as errors", async () => {
    const chat = new OpenAICompatibleChat({ id: "openai", baseUrl: "https://api.test/v1", apiKey: "k", model: "m", fetchImpl: async () => new Response("nope", { status: 429 }) });
    await expect(chat.chat({ system: "s", turns: [{ role: "user", content: "x" }], tools: [] }, collect().emit)).rejects.toThrow(/429/);
  });
});

describe("SimulatedChat", () => {
  it("answers from the workspace tools and labels the answer as simulated", async () => {
    const { events, emit } = collect();
    const out = await new SimulatedChat().chat({ system: "s", turns: [{ role: "user", content: "How is my brand performing?" }], tools: [metricsTool] }, emit);
    expect(out.toolCalls).toEqual([{ name: "get_visibility_metrics", ok: true }]);
    expect(out.text).toMatch(/simulated/i);
    expect(out.text).toContain("50%");
    expect(events.some((e) => e.type === "tool" && e.status === "done")).toBe(true);
  });
});

describe("provider selection and fallback", () => {
  const ok = (id: string): ChatProvider => ({ id, simulated: false, chat: async (_r, emit) => (emit({ type: "text", delta: id }), { text: id, toolCalls: [], finish: "end" }) });
  const failsEarly: ChatProvider = { id: "early", simulated: false, chat: async () => { throw new Error("401"); } };
  const failsLate: ChatProvider = { id: "late", simulated: false, chat: async (_r, emit) => { emit({ type: "text", delta: "partial" }); throw new Error("connection reset"); } };
  const req = { system: "s", turns: [{ role: "user" as const, content: "x" }], tools: [] };

  it("falls back only while nothing has been streamed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: ChatEvent[] = [];
    await expect(runChat(req, (e) => seen.push(e), [failsEarly, ok("second")])).resolves.toMatchObject({ provider: "second", text: "second" });
    expect(seen).toEqual([{ type: "provider", id: "early", simulated: false }, { type: "provider", id: "second", simulated: false }, { type: "text", delta: "second" }]);
    await expect(runChat(req, () => {}, [failsLate, ok("second")])).rejects.toThrow();
    await expect(runChat(req, () => {}, [])).rejects.toBeInstanceOf(ChatUnavailableError);
  });

  it("picks providers from the environment; the simulator only outside production", () => {
    expect(availableChatProviders({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }).map((p) => p.id)).toEqual(["anthropic", "openai"]);
    expect(availableChatProviders({ LLM_SIMULATED_PROVIDER: "true", NODE_ENV: "development" }).map((p) => p.id)).toEqual(["simulated"]);
    expect(availableChatProviders({ LLM_SIMULATED_PROVIDER: "true", NODE_ENV: "production" })).toEqual([]);
    expect(availableChatProviders({ LLM_SIMULATED_PROVIDER: "true", NODE_ENV: "development", OPENAI_API_KEY: "o" }).map((p) => p.id)).toEqual(["openai", "simulated"]);
  });
});
