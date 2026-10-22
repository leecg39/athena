/**
 * Claude via the official SDK: streaming manual tool loop (messages.stream +
 * finalMessage). Claude Opus 5.5 always uses adaptive thinking, so `thinking`
 * is omitted, and the full assistant content (thinking blocks included) is
 * sent back inside the loop. Tool inputs are a few small fields, so eager input
 * streaming stays off: the API validates each input before the turn ends and a
 * turn never has to be re-issued after its text was already streamed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runTool } from "./tool-runner";
import { DEFAULT_MAX_STEPS, type ChatEvent, type ChatOutcome, type ChatProvider, type ChatRequest, type ToolCallSummary } from "./types";

export const CLAUDE_CHAT_MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";

export class AnthropicChat implements ChatProvider {
  readonly id = "anthropic";
  readonly simulated = false;

  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model: string = CLAUDE_CHAT_MODEL,
  ) {}

  async chat(req: ChatRequest, emit: (e: ChatEvent) => void): Promise<ChatOutcome> {
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
    let messages: Anthropic.MessageParam[] = req.turns.map((t) => ({ role: t.role, content: t.content }));
    let text = "";
    let toolCalls: ToolCallSummary[] = [];
    const say = (delta: string) => {
      text += delta;
      emit({ type: "text", delta });
    };
    for (let step = 0; step <= (req.maxSteps ?? DEFAULT_MAX_STEPS); step++) {
      const stream = this.client.messages.stream({ model: this.model, max_tokens: 16000, system: req.system, messages, ...(tools.length ? { tools } : {}) }, { signal: req.signal });
      stream.on("text", (delta) => say(delta));
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") return { text, toolCalls, finish: "refused" };
      if (message.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: message.content }];
        continue;
      }
      const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      // never run a tool whose input may have been cut off at max_tokens
      if (!uses.length || message.stop_reason === "max_tokens") return { text, toolCalls, finish: message.stop_reason === "max_tokens" ? "truncated" : "end" };
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const r = await runTool(req.tools, use.name, use.input, emit);
        toolCalls = [...toolCalls, { name: use.name, ok: r.ok }];
        results.push({ type: "tool_result", tool_use_id: use.id, content: r.content, is_error: !r.ok });
      }
      messages = [...messages, { role: "assistant", content: message.content }, { role: "user", content: results }];
      if (text && !text.endsWith("\n")) say("\n\n");
    }
    return { text, toolCalls, finish: "truncated" };
  }
}
