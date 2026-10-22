/**
 * Development stand-in (LLM_SIMULATED_PROVIDER, never in production): routes
 * the question to workspace tools by keyword and writes a templated answer
 * from their real results. Clearly labelled as simulated.
 */
import { chunks, runTool } from "./tool-runner";
import type { ChatEvent, ChatOutcome, ChatProvider, ChatRequest, ToolCallSummary } from "./types";

type Json = Record<string, any>;

const ROUTES: { test: RegExp; tool: string; input: Json }[] = [
  { test: /compet|rival|versus|\bvs\b|compare/i, tool: "compare_competitors", input: { days: 30 } },
  { test: /source|cite|citation|domain/i, tool: "top_sources", input: { days: 30, limit: 5 } },
  { test: /content|write|creat|publish|gap|opportunit|improve|recommend|should i/i, tool: "find_content_opportunities", input: { days: 30 } },
  { test: /search console|gsc|quer(y|ies)|keyword/i, tool: "search_console_queries", input: { limit: 10 } },
  { test: /\banswers?\b|responses?|example/i, tool: "search_answers", input: { days: 30, limit: 3 } },
];

const pct = (v: unknown) => (typeof v === "number" ? `${v}%` : "—");

const FORMAT: Record<string, (r: Json) => string> = {
  get_visibility_metrics: (r) =>
    [
      `Over the last ${r.period?.days} days, ${r.answers} AI answers were sampled: mention rate **${pct(r.mentionRate)}**, citation rate **${pct(r.citationRate)}**, share of voice **${pct(r.shareOfVoice)}**, average position ${r.avgPosition ?? "—"}.`,
      r.change ? `Change vs the previous period: mention rate ${r.change.mentionRate > 0 ? "+" : ""}${r.change.mentionRate} pts.` : "",
    ].join(" "),
  compare_competitors: (r) =>
    ["| Brand | Mention rate | Share of voice | Avg position |", "|---|---|---|---|", ...(r.entities ?? []).map((e: Json) => `| ${e.name} | ${pct(e.mentionRate)} | ${pct(e.shareOfVoice)} | ${e.avgPosition ?? "—"} |`)].join("\n"),
  top_sources: (r) => (r.sources ?? []).map((s: Json) => `- **${s.domain}** (${s.type}) cited in ${pct(s.citationRate)} of answers`).join("\n"),
  search_answers: (r) => (r.answers ?? []).map((a: Json) => `- **${a.prompt}** (${a.model}): ${a.mentioned ? "mentions you" : "does not mention you"} · [view answer](${a.link})`).join("\n") || "No matching answers.",
  find_content_opportunities: (r) =>
    [
      "**Prompts where competitors win:**",
      ...(r.lostPrompts ?? []).map((p: Json) => `- ${p.prompt} (${p.competitors.join(", ")})`),
      "**Sources to pitch:**",
      ...(r.gapSources ?? []).map((s: Json) => `- ${s.domain}`),
    ].join("\n"),
  search_console_queries: (r) => (r.queries ?? []).map((q: Json) => `- ${q.query}: ${q.clicks} clicks, ${q.impressions} impressions`).join("\n"),
};

export class SimulatedChat implements ChatProvider {
  readonly id = "simulated";
  readonly simulated = true;

  async chat(req: ChatRequest, emit: (e: ChatEvent) => void): Promise<ChatOutcome> {
    const question = [...req.turns].reverse().find((t) => t.role === "user")?.content ?? "";
    const available = new Set(req.tools.map((t) => t.name));
    const picked = ROUTES.filter((r) => available.has(r.tool) && r.test.test(question)).slice(0, 2);
    const plan = picked.length ? picked : [{ tool: "get_visibility_metrics", input: { days: 30 } }].filter((r) => available.has(r.tool));
    let toolCalls: ToolCallSummary[] = [];
    const sections: string[] = [];
    for (const step of plan) {
      const r = await runTool(req.tools, step.tool, step.input, emit);
      toolCalls = [...toolCalls, { name: step.tool, ok: r.ok }];
      sections.push(r.ok ? (FORMAT[step.tool]?.(JSON.parse(r.content)) ?? "") : `_${step.tool} failed: ${r.content}_`);
    }
    const text = ["_Simulated answer: no AI model was called (LLM_SIMULATED_PROVIDER). The figures come from your workspace data._", ...sections].filter(Boolean).join("\n\n");
    chunks(text).forEach((delta) => emit({ type: "text", delta }));
    return { text, toolCalls, finish: "end" };
  }
}
