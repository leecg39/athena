/**
 * Markdown → HTML for CMS publishing. Every piece of text is HTML-escaped;
 * links are kept only for http(s) URLs and site-relative paths.
 */

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;
const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+/;
const HEADING = /^(#{1,6})\s+/;
const FENCE = /^\s*```/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const safeHref = (url: string) => (/^https?:\/\/[^\s]+$/i.test(url) || /^\/(?!\/)[^\s]*$/.test(url) ? url : null);

function inline(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    out += escapeHtml(text.slice(last, at));
    const token = m[0];
    if (m[1]) out += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    else if (m[2]) out += `<strong>${inline(token.slice(2, -2))}</strong>`;
    else if (m[3]) {
      const label = token.slice(1, token.indexOf("]("));
      const url = token.slice(token.indexOf("](") + 2, -1);
      const href = safeHref(url);
      out += href ? `<a href="${escapeHtml(href)}">${inline(label)}</a>` : `${escapeHtml(label)} (${escapeHtml(url)})`;
    } else out += `<em>${inline(token.slice(1, -1))}</em>`;
    last = at + token.length;
  }
  return out + escapeHtml(text.slice(last));
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isStart = (l: string, next = "") => FENCE.test(l) || HEADING.test(l) || BULLET.test(l) || NUMBERED.test(l) || l.trim().startsWith(">") || (l.trim().startsWith("|") && TABLE_SEP.test(next));
const until = (lines: string[], from: number, keep: (l: string, i: number) => boolean) => {
  const at = lines.findIndex((l, i) => i >= from && !keep(l, i));
  return at === -1 ? lines.length : at;
};

function block(lines: string[], i: number): [string | null, number] {
  const line = lines[i];
  if (!line.trim()) return [null, i + 1];
  if (FENCE.test(line)) {
    const end = until(lines, i + 1, (l) => !FENCE.test(l));
    return [`<pre><code>${escapeHtml(lines.slice(i + 1, end).join("\n"))}</code></pre>`, end + 1];
  }
  const h = HEADING.exec(line);
  if (h) return [`<h${h[1].length}>${inline(line.replace(HEADING, ""))}</h${h[1].length}>`, i + 1];
  if (BULLET.test(line) || NUMBERED.test(line)) {
    const re = BULLET.test(line) ? BULLET : NUMBERED;
    const end = until(lines, i, (l) => re.test(l));
    const tag = re === BULLET ? "ul" : "ol";
    return [`<${tag}>${lines.slice(i, end).map((l) => `<li>${inline(l.replace(re, ""))}</li>`).join("")}</${tag}>`, end];
  }
  if (line.trim().startsWith("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
    const end = until(lines, i + 2, (l) => l.trim().startsWith("|"));
    const head = cells(line).map((c) => `<th>${inline(c)}</th>`).join("");
    const rows = lines.slice(i + 2, end).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
    return [`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`, end];
  }
  if (line.trim().startsWith(">")) {
    const end = until(lines, i, (l) => l.trim().startsWith(">"));
    return [`<blockquote>${inline(lines.slice(i, end).map((l) => l.trim().replace(/^>\s?/, "")).join(" "))}</blockquote>`, end];
  }
  const end = until(lines, i + 1, (l, j) => Boolean(l.trim()) && !isStart(l, lines[j + 1]));
  return [`<p>${inline(lines.slice(i, end).join(" "))}</p>`, end];
}

function blocks(lines: string[], from = 0): string[] {
  if (from >= lines.length) return [];
  const [html, next] = block(lines, from);
  return html ? [html, ...blocks(lines, next)] : blocks(lines, next);
}

export function markdownToHtml(markdown: string): string {
  return blocks(markdown.split(/\r?\n/)).join("\n");
}
