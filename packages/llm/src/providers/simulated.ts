/**
 * DEV-ONLY simulated provider. Produces deterministic, clearly synthetic answers
 * so the pipeline can be exercised without API keys. Every row it produces is
 * stored with `simulated = true` and labelled in the UI. Never enabled in production.
 */
import { createHash } from "node:crypto";
import type { CollectedAnswer, CollectOptions, SearchAdapter } from "./types";

const SOURCES = ["reddit.com", "youtube.com", "g2.com", "medium.com", "wikipedia.org", "techcrunch.com"];

function score(seed: string): number {
  return parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) / 0xffffffff;
}

export class SimulatedAdapter implements SearchAdapter {
  readonly model = "simulated" as const;
  readonly label = "Simulated (dev)";

  /** `clock` lets the seed script produce different answers per simulated day */
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async collect(prompt: string, opts: CollectOptions = {}): Promise<CollectedAnswer> {
    const day = this.clock().toISOString().slice(0, 10);
    const entities = (opts.entities ?? []).filter((e) => score(`${prompt}|${e}|${day}`) > 0.4);
    const sources = SOURCES.filter((s) => score(`${prompt}|${s}|${day}`) > 0.6);
    const lines = [
      `[SIMULATED ANSWER — not produced by a real AI model] For "${prompt}":`,
      ...entities.map((e, i) => `${i + 1}. ${e} — frequently recommended option.`),
      ...sources.map((s) => `Source: https://${s}/`),
    ];
    const text = lines.join("\n");
    return { text, citations: sources.map((s) => ({ url: `https://${s}/` })), provider: "simulated:dev", tokensIn: prompt.length, tokensOut: text.length, simulated: true };
  }
}
