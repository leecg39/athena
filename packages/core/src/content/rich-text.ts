/**
 * Draft tree → the structured rich-text formats headless CMSs store:
 * Sanity Portable Text, Contentful Rich Text and Payload's Lexical state.
 * Tables (and fenced code where a format has no code block) degrade to plain
 * formatted lines instead of being dropped.
 */
import { inlineRuns, type Block, type Inline, type Mark, type Run } from "./markdown-ast";

const SEP: Run = { text: " | ", marks: [], href: null };
const bold = (runs: Run[]): Run[] => runs.map((r) => (r.marks.includes("strong") ? r : { ...r, marks: ["strong" as Mark, ...r.marks] }));
const joinCells = (cells: Inline[][], header: boolean): Run[] =>
  cells.flatMap((c, i) => [...(i ? [SEP] : []), ...(header ? bold(inlineRuns(c)) : inlineRuns(c))]);
const codeRun = (value: string): Run[] => [{ text: value, marks: ["code"], href: null }];

/** Consecutive runs that share a link become one group (null href = plain text). */
function linkGroups(runs: Run[]): { href: string | null; runs: Run[] }[] {
  return runs.reduce<{ href: string | null; runs: Run[] }[]>((acc, r) => {
    const prev = acc.at(-1);
    return prev && prev.href !== null && prev.href === r.href ? [...acc.slice(0, -1), { ...prev, runs: [...prev.runs, r] }] : [...acc, { href: r.href, runs: [r] }];
  }, []);
}

// ---- Sanity Portable Text ----

export interface PtSpan { _type: "span"; _key: string; text: string; marks: string[] }
export interface PtBlock { _type: "block"; _key: string; style: string; markDefs: { _type: "link"; _key: string; href: string }[]; children: PtSpan[]; listItem?: "bullet" | "number"; level?: number }

function ptBlock(key: string, style: string, runs: Run[], list?: "bullet" | "number"): PtBlock {
  const hrefs = [...new Set(runs.flatMap((r) => (r.href ? [r.href] : [])))];
  const markDefs = hrefs.map((href, i) => ({ _type: "link" as const, _key: `${key}l${i}`, href }));
  const linkKey = (href: string | null) => (href ? [markDefs[hrefs.indexOf(href)]._key] : []);
  const children = (runs.length ? runs : [{ text: "", marks: [], href: null }]).map((r, i): PtSpan => ({ _type: "span", _key: `${key}s${i}`, text: r.text, marks: [...r.marks, ...linkKey(r.href)] }));
  return { _type: "block", _key: key, style, markDefs, children, ...(list ? { listItem: list, level: 1 } : {}) };
}

export function toPortableText(blocks: Block[]): PtBlock[] {
  return blocks.flatMap((b, i): PtBlock[] => {
    const key = `b${i}`;
    if (b.type === "heading") return [ptBlock(key, `h${b.level}`, inlineRuns(b.children))];
    if (b.type === "paragraph") return [ptBlock(key, "normal", inlineRuns(b.children))];
    if (b.type === "quote") return [ptBlock(key, "blockquote", inlineRuns(b.children))];
    if (b.type === "code") return [ptBlock(key, "normal", codeRun(b.value))];
    if (b.type === "list") return b.items.map((item, j) => ptBlock(`${key}i${j}`, "normal", inlineRuns(item), b.ordered ? "number" : "bullet"));
    return [b.head, ...b.rows].map((cells, j) => ptBlock(`${key}r${j}`, "normal", joinCells(cells, j === 0)));
  });
}

// ---- Contentful Rich Text ----

export interface CfNode { nodeType: string; data: Record<string, unknown>; content?: CfNode[]; value?: string; marks?: { type: string }[] }
const CF_MARK: Record<Mark, string> = { strong: "bold", em: "italic", code: "code" };
const cfText = (r: Run): CfNode => ({ nodeType: "text", value: r.text, marks: r.marks.map((m) => ({ type: CF_MARK[m] })), data: {} });
const cfInline = (runs: Run[]): CfNode[] =>
  linkGroups(runs).map((g) => (g.href ? { nodeType: "hyperlink", data: { uri: g.href }, content: g.runs.map(cfText) } : cfText(g.runs[0])));
const cfNode = (nodeType: string, runs: Run[]): CfNode => ({ nodeType, data: {}, content: runs.length ? cfInline(runs) : [cfText({ text: "", marks: [], href: null })] });
const cfWrap = (nodeType: string, content: CfNode[]): CfNode => ({ nodeType, data: {}, content });

function cfTable(head: Inline[][], rows: Inline[][][]): CfNode {
  const pad = (cells: Inline[][]) => [...cells, ...Array.from({ length: Math.max(0, head.length - cells.length) }, (): Inline[] => [])];
  const row = (cells: Inline[][], cellType: string) => cfWrap("table-row", pad(cells).map((c) => cfWrap(cellType, [cfNode("paragraph", inlineRuns(c))])));
  return cfWrap("table", [row(head, "table-header-cell"), ...rows.map((r) => row(r, "table-cell"))]);
}

function cfBlock(b: Block): CfNode {
  if (b.type === "heading") return cfNode(`heading-${b.level}`, inlineRuns(b.children));
  if (b.type === "paragraph") return cfNode("paragraph", inlineRuns(b.children));
  if (b.type === "quote") return cfWrap("blockquote", [cfNode("paragraph", inlineRuns(b.children))]);
  if (b.type === "code") return cfNode("paragraph", codeRun(b.value));
  if (b.type === "list") return cfWrap(b.ordered ? "ordered-list" : "unordered-list", b.items.map((item) => cfWrap("list-item", [cfNode("paragraph", inlineRuns(item))])));
  return cfTable(b.head, b.rows);
}

export function toContentfulRichText(blocks: Block[]): CfNode {
  return cfWrap("document", blocks.length ? blocks.map(cfBlock) : [cfNode("paragraph", [])]);
}

// ---- Payload Lexical ----

export type LexNode = Record<string, unknown>;
const LEX_FORMAT: Record<Mark, number> = { strong: 1, em: 2, code: 16 };
const ELEMENT = { direction: "ltr", format: "", indent: 0 } as const;
const lexText = (r: Run): LexNode => ({ type: "text", text: r.text, format: r.marks.reduce((f, m) => f | LEX_FORMAT[m], 0), detail: 0, mode: "normal", style: "", version: 1 });
const lexInline = (runs: Run[]): LexNode[] =>
  linkGroups(runs).map((g) => (g.href ? { type: "link", fields: { url: g.href, newTab: false, linkType: "custom" }, children: g.runs.map(lexText), ...ELEMENT, version: 3 } : lexText(g.runs[0])));
const lexParagraph = (children: LexNode[]): LexNode => ({ type: "paragraph", children, ...ELEMENT, version: 1, textFormat: 0, textStyle: "" });
const lexCode = (value: string): LexNode[] =>
  value.split("\n").flatMap((line, i) => [...(i ? [{ type: "linebreak", version: 1 }] : []), ...(line ? [lexText({ text: line, marks: ["code"], href: null })] : [])]);

function lexBlock(b: Block): LexNode[] {
  if (b.type === "heading") return [{ type: "heading", tag: `h${b.level}`, children: lexInline(inlineRuns(b.children)), ...ELEMENT, version: 1 }];
  if (b.type === "paragraph") return [lexParagraph(lexInline(inlineRuns(b.children)))];
  if (b.type === "quote") return [{ type: "quote", children: lexInline(inlineRuns(b.children)), ...ELEMENT, version: 1 }];
  if (b.type === "code") return [lexParagraph(lexCode(b.value))];
  if (b.type === "list") {
    const items = b.items.map((item, j) => ({ type: "listitem", value: j + 1, children: lexInline(inlineRuns(item)), ...ELEMENT, version: 1 }));
    return [{ type: "list", listType: b.ordered ? "number" : "bullet", tag: b.ordered ? "ol" : "ul", start: 1, children: items, ...ELEMENT, version: 1 }];
  }
  return [b.head, ...b.rows].map((cells, j) => lexParagraph(lexInline(joinCells(cells, j === 0))));
}

export function toLexical(blocks: Block[]): { root: LexNode & { children: LexNode[] } } {
  return { root: { type: "root", children: blocks.flatMap(lexBlock), ...ELEMENT, version: 1 } };
}
