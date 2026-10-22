/** Provider-agnostic chat with read-only data tools (Ask Athena). */

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema of the input object */
  inputSchema: Record<string, unknown>;
  /** validates the model-supplied input, then runs */
  run(input: unknown): Promise<unknown>;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "running" | "done" | "error" }
  /** emitted by runChat before each provider attempt (providers never emit it) */
  | { type: "provider"; id: string; simulated: boolean };

export interface ChatRequest {
  system: string;
  turns: ChatTurn[];
  tools: ChatTool[];
  signal?: AbortSignal;
  /** tool rounds before the answer is cut off (default 6) */
  maxSteps?: number;
}

export interface ToolCallSummary {
  name: string;
  ok: boolean;
}

export interface ChatOutcome {
  text: string;
  toolCalls: ToolCallSummary[];
  /** end = finished; truncated = token or step limit; refused = the model declined */
  finish: "end" | "truncated" | "refused";
}

export interface ChatProvider {
  readonly id: string;
  readonly simulated: boolean;
  chat(req: ChatRequest, emit: (e: ChatEvent) => void): Promise<ChatOutcome>;
}

export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatError";
  }
}

/** No chat provider is configured (no API key, simulator off). */
export class ChatUnavailableError extends ChatError {
  constructor() {
    super("No AI provider is configured for Ask Athena");
    this.name = "ChatUnavailableError";
  }
}

export const DEFAULT_MAX_STEPS = 6;
