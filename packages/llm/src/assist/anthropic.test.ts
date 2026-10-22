import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicAssist } from "./anthropic";

const Schema = z.object({ ok: z.boolean() });

function stubClient(result: Record<string, unknown>) {
  const parse = vi.fn(async (_params: unknown) => result);
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe("AnthropicAssist", () => {
  it("calls beta.messages.parse with claude-opus-5-5, low effort, schema format and server-side fallback", async () => {
    const { client, parse } = stubClient({ stop_reason: "end_turn", parsed_output: { ok: true } });
    await expect(new AnthropicAssist(client).generate({ system: "sys", prompt: "hi", schema: Schema })).resolves.toEqual({ ok: true });
    const params = parse.mock.calls[0][0] as unknown as Record<string, unknown> & { output_config: { effort: string; format: unknown } };
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format).toBeTruthy();
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("thinking");
  });

  it("surfaces refusals, truncation and unparseable output as errors", async () => {
    for (const result of [
      { stop_reason: "refusal", parsed_output: null },
      { stop_reason: "max_tokens", parsed_output: null },
      { stop_reason: "end_turn", parsed_output: null },
    ]) {
      const { client } = stubClient(result);
      await expect(new AnthropicAssist(client).generate({ system: "s", prompt: "p", schema: Schema })).rejects.toThrow();
    }
  });
});
