/**
 * What content writing may rely on: confirmed Knowledge Base facts, real
 * internal pages, tracked competitor names and the linked prompt. Templates
 * assert nothing else — gaps become [bracketed] placeholders for the writer.
 */
import { and, eq, isNull } from "drizzle-orm";
import { type Db, kbFacts, siteHealthPages, competitors, prompts } from "@athena/db";
import type { WebsiteRow } from "../tenancy";
import { decodeEntities, textOf } from "../shared/html";

export interface GroundingContext {
  brand: string;
  domain: string;
  /** confirmed Knowledge Base claims only */
  facts: string[];
  /** pages of the site that were actually crawled */
  internalLinks: { url: string; title: string }[];
  competitorNames: string[];
  promptText: string | null;
}

type Columns = Record<string, string | number | boolean>;

export async function loadGroundingContext(db: Db, site: Pick<WebsiteRow, "id" | "name" | "domain">, promptId?: string | null): Promise<GroundingContext> {
  const [factRows, linkRows, compRows, promptRow] = await Promise.all([
    db.select({ claim: kbFacts.claim }).from(kbFacts).where(and(eq(kbFacts.websiteId, site.id), eq(kbFacts.status, "confirmed"), isNull(kbFacts.deletedAt))).orderBy(kbFacts.createdAt).limit(12),
    db.select({ url: siteHealthPages.url, title: siteHealthPages.title }).from(siteHealthPages).where(and(eq(siteHealthPages.websiteId, site.id), eq(siteHealthPages.statusCode, 200))).limit(10),
    db.select({ name: competitors.name }).from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt))).orderBy(competitors.createdAt).limit(6),
    promptId ? db.select({ text: prompts.text }).from(prompts).where(and(eq(prompts.id, promptId), eq(prompts.websiteId, site.id))).limit(1) : Promise.resolve([] as { text: string }[]),
  ]);
  return {
    brand: site.name,
    domain: site.domain,
    facts: factRows.map((f) => f.claim),
    internalLinks: linkRows.map((l) => ({ url: l.url, title: l.title || l.url })),
    competitorNames: compRows.map((c) => c.name),
    promptText: promptRow[0]?.text ?? null,
  };
}

const factsBlock = (ctx: GroundingContext) =>
  ctx.facts.length ? ctx.facts.slice(0, 6).map((f) => `- ${f}`).join("\n") : `- [Add facts about ${ctx.brand} — confirm them in the Knowledge Base first]`;
const linksBlock = (ctx: GroundingContext) =>
  ctx.internalLinks.length ? ctx.internalLinks.slice(0, 5).map((l) => `- [${l.title}](${l.url})`).join("\n") : `- [Add links to relevant ${ctx.domain} pages]`;
const questionOf = (item: { title: string; columns: Columns }, ctx: GroundingContext) => ctx.promptText || String(item.columns.targetKeyword || item.title);
const rivalsOf = (ctx: GroundingContext) => (ctx.competitorNames.length ? ctx.competitorNames.slice(0, 3).join(", ") : "[alternatives readers compare]");

export function templateBrief(item: { title: string; columns: Columns }, ctx: GroundingContext, notes?: string): string {
  const query = questionOf(item, ctx);
  return [
    `# Content brief: ${item.title}`,
    [`- **Question to answer**: ${query}`, `- **Reader**: ${String(item.columns.persona || "[Target reader]")}`, `- **Format**: ${String(item.columns.contentType || "Article")}`, notes?.trim() ? `- **Editorial focus**: ${notes.trim()}` : ""].filter(Boolean).join("\n"),
    `## Goal\nGive a direct, well-sourced answer to "${query}" that AI assistants can quote, and explain where ${ctx.brand} fits next to ${rivalsOf(ctx)}.`,
    `## Facts to use (confirmed in the Knowledge Base)\n${factsBlock(ctx)}`,
    `## Internal links\n${linksBlock(ctx)}`,
    `## Suggested outline\n1. Short answer (2-3 sentences)\n2. How ${ctx.brand} approaches it — confirmed facts only\n3. Comparison with ${rivalsOf(ctx)} — sourced and neutral\n4. FAQ (3 questions readers ask)`,
  ].join("\n\n");
}

export function templateDraft(item: { title: string; columns: Columns }, ctx: GroundingContext): string {
  const query = questionOf(item, ctx);
  const rivals = ctx.competitorNames.slice(0, 3);
  const table = rivals.length
    ? [`| Criteria | ${ctx.brand} | ${rivals.join(" | ")} |`, `|${" --- |".repeat(rivals.length + 2)}`, `| [criterion] | [fill in] |${" [fill in] |".repeat(rivals.length)}`].join("\n")
    : `[Add a comparison with the alternatives readers consider]`;
  return [
    `# ${item.title}`,
    `**Short answer:** [Write a 2-3 sentence answer to "${query}".]`,
    `## How ${ctx.brand} helps\n${factsBlock(ctx)}`,
    `## Comparison\n${table}\n\n[Cite a source for every comparison claim.]`,
    `## Related pages\n${linksBlock(ctx)}`,
    `## FAQ\n### [Question readers ask]\n[Answer using confirmed facts only.]`,
  ].join("\n\n");
}

const CHROME = /<(script|style|noscript|nav|header|footer|aside|form|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK = /<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const MAX_HTML = 1_500_000;
const MAX_BODY = 60_000;

/** The page's own words as a markdown draft: headings, paragraphs and lists, no site chrome. */
export function pageToDraft(html: string): { title: string; body: string } {
  const page = html.slice(0, MAX_HTML).replace(CHROME, " ");
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(page)?.[2] ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(page)?.[1] ?? page;
  const blocks = [...main.matchAll(BLOCK)]
    .map((m) => ({ tag: m[1].toLowerCase(), text: textOf(m[2]) }))
    .filter((b) => b.text);
  const lines = blocks.map((b) => (b.tag.startsWith("h") ? `${"#".repeat(Math.min(3, Number(b.tag[1])))} ${b.text}` : b.tag === "li" ? `- ${b.text}` : b.tag === "blockquote" ? `> ${b.text}` : b.text));
  const body = lines.reduce((acc, line, i) => (i === 0 ? line : `${acc}${line.startsWith("- ") && lines[i - 1].startsWith("- ") ? "\n" : "\n\n"}${line}`), "");
  const h1 = blocks.find((b) => b.tag === "h1")?.text;
  const docTitle = decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  return { title: (h1 || docTitle).slice(0, 220), body: body.slice(0, MAX_BODY) };
}
