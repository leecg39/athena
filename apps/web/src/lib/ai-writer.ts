import "server-only";
import * as z from "zod/v4";
import { generateStructured } from "@athena/llm/assist";

export type Written = { ok: true; text: string; provider: string } | { ok: false; reason: "unavailable" | "failed" };

/**
 * Free text from the configured AI provider (returned as JSON `{ text }`).
 * With no provider configured callers get `unavailable` and must fall back to
 * something honest (a template from verified data), never invented content.
 */
export async function writeWithAI(input: { system: string; prompt: string; maxTokens?: number }): Promise<Written> {
  const r = await generateStructured({
    system: input.system,
    prompt: input.prompt,
    schema: z.object({ text: z.string().min(1).max(12_000) }),
    maxTokens: input.maxTokens ?? 4000,
  });
  if (!r.ok) {
    if (r.reason === "failed") console.warn("[ai-writer] generation failed", r.error);
    return { ok: false, reason: r.reason };
  }
  return { ok: true, text: r.data.text.trim(), provider: r.provider };
}
