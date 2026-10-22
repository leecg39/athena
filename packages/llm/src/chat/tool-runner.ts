import * as z from "zod/v4";
import { DomainError } from "@athena/core/org";
import type { ChatEvent, ChatTool } from "./types";

const MAX_RESULT_CHARS = 30_000;

/** What the model is told when a tool fails (no internals for unexpected errors). */
export function toolErrorMessage(err: unknown): string {
  if (err instanceof z.ZodError) return `Invalid input: ${err.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`;
  if (err instanceof DomainError) return err.message;
  return "The tool failed. Tell the user this data could not be loaded right now.";
}

export async function runTool(tools: ChatTool[], name: string, input: unknown, emit: (e: ChatEvent) => void): Promise<{ ok: boolean; content: string }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, content: `Unknown tool: ${name}` };
  emit({ type: "tool", name, status: "running" });
  try {
    const json = JSON.stringify(await tool.run(input)) ?? "null";
    emit({ type: "tool", name, status: "done" });
    return { ok: true, content: json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}… [truncated]` : json };
  } catch (err) {
    if (!(err instanceof z.ZodError) && !(err instanceof DomainError)) console.error("[chat] tool failed", name, err);
    emit({ type: "tool", name, status: "error" });
    return { ok: false, content: toolErrorMessage(err) };
  }
}

/** Splits text into small deltas so non-streaming providers still render progressively. */
export function chunks(text: string, size = 48): string[] {
  return text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];
}
