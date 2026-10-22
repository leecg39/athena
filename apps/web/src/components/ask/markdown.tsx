/**
 * Minimal, safe Markdown for AI answers: builds React elements only (no HTML
 * injection), and links only http(s) URLs or app-relative paths.
 */
import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+/;
const HEADING = /^#{1,4}\s+/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;

/** http(s) URLs and same-origin paths only (no javascript:, data:, //host). */
export function safeHref(url: string): string | null {
  const u = url.trim();
  return /^https?:\/\/[^\s]+$/i.test(u) || /^\/(?!\/)[^\s]*$/.test(u) ? u : null;
}

function link(label: string, url: string, key: string): ReactNode {
  const href = safeHref(url);
  if (!href) return `${label} (${url})`;
  const external = !href.startsWith("/");
  return (
    <a key={key} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})} className="font-medium text-brand-600 underline underline-offset-2">
      {label}
    </a>
  );
}

function inline(text: string, prefix = "i"): ReactNode[] {
  const parts = [...text.matchAll(INLINE)];
  if (!parts.length) return [text];
  return parts.flatMap((m, i) => {
    const start = m.index ?? 0;
    const before = text.slice(i === 0 ? 0 : (parts[i - 1].index ?? 0) + parts[i - 1][0].length, start);
    const key = `${prefix}${i}`;
    const token = m[0];
    const node = m[1] ? (
      <code key={key} className="rounded bg-gray-100 px-1 py-0.5 text-[0.85em]">
        {token.slice(1, -1)}
      </code>
    ) : m[2] ? (
      <strong key={key}>{inline(token.slice(2, -2), key)}</strong>
    ) : m[3] ? (
      link(token.slice(1, token.indexOf("](")), token.slice(token.indexOf("](") + 2, -1), key)
    ) : (
      <em key={key}>{inline(token.slice(1, -1), key)}</em>
    );
    const tail = i === parts.length - 1 ? text.slice(start + token.length) : "";
    return [before, node, tail].filter((n) => n !== "");
  });
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isBlockStart = (line: string, next = "") => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || BULLET.test(line) || NUMBERED.test(line) || line.trim().startsWith(">") || (line.trim().startsWith("|") && TABLE_SEP.test(next));

/** Index of the first line at or after `from` that fails `keep` (or the end). */
function until(lines: string[], from: number, keep: (line: string, i: number) => boolean): number {
  const at = lines.findIndex((l, i) => i >= from && !keep(l, i));
  return at === -1 ? lines.length : at;
}

function readBlock(lines: string[], i: number): [Block | null, number] {
  const line = lines[i];
  if (!line.trim()) return [null, i + 1];
  if (FENCE.test(line)) {
    const end = until(lines, i + 1, (l) => !FENCE.test(l));
    return [{ kind: "code", text: lines.slice(i + 1, end).join("\n") }, end + 1];
  }
  if (HEADING.test(line)) return [{ kind: "heading", text: line.replace(HEADING, "") }, i + 1];
  if (RULE.test(line)) return [{ kind: "rule" }, i + 1];
  if (BULLET.test(line) || NUMBERED.test(line)) {
    const re = BULLET.test(line) ? BULLET : NUMBERED;
    const end = until(lines, i, (l) => re.test(l));
    return [{ kind: "list", ordered: re === NUMBERED, items: lines.slice(i, end).map((l) => l.replace(re, "")) }, end];
  }
  if (line.trim().startsWith("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
    const end = until(lines, i + 2, (l) => l.trim().startsWith("|"));
    return [{ kind: "table", head: cells(line), rows: lines.slice(i + 2, end).map(cells) }, end];
  }
  if (line.trim().startsWith(">")) {
    const end = until(lines, i, (l) => l.trim().startsWith(">"));
    return [{ kind: "quote", text: lines.slice(i, end).map((l) => l.trim().replace(/^>\s?/, "")).join(" ") }, end];
  }
  const end = until(lines, i + 1, (l, j) => Boolean(l.trim()) && !isBlockStart(l, lines[j + 1]));
  return [{ kind: "paragraph", text: lines.slice(i, end).join(" ") }, end];
}

export function parseBlocks(lines: string[], from = 0): Block[] {
  if (from >= lines.length) return [];
  const [block, next] = readBlock(lines, from);
  return block ? [block, ...parseBlocks(lines, next)] : parseBlocks(lines, next);
}

function renderTable(b: Extract<Block, { kind: "table" }>, key: string) {
  return (
    <div key={key} className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            {b.head.map((h, i) => (
              <th key={i} className="border-b border-gray-200 px-2 py-1 text-left font-semibold">
                {inline(h, `${key}h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className="border-b border-gray-100 px-2 py-1">
                  {inline(c, `${key}r${ri}c${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderBlock(b: Block, i: number): ReactNode {
  const key = `b${i}`;
  switch (b.kind) {
    case "heading":
      return <h3 key={key} className="font-semibold text-gray-900">{inline(b.text, key)}</h3>;
    case "paragraph":
      return <p key={key}>{inline(b.text, key)}</p>;
    case "list": {
      const items = b.items.map((it, j) => <li key={j}>{inline(it, `${key}l${j}`)}</li>);
      return b.ordered ? <ol key={key} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={key} className="list-disc space-y-1 pl-5">{items}</ul>;
    }
    case "code":
      return <pre key={key} className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs"><code>{b.text}</code></pre>;
    case "table":
      return renderTable(b, key);
    case "quote":
      return <blockquote key={key} className="border-l-2 border-gray-200 pl-3 text-gray-600">{inline(b.text, key)}</blockquote>;
    case "rule":
      return <hr key={key} className="border-gray-100" />;
  }
}

export function Markdown({ text }: { text: string }) {
  return <div className="space-y-3 text-sm leading-relaxed text-gray-800">{parseBlocks(text.split(/\r?\n/)).map(renderBlock)}</div>;
}
