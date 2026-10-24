/**
 * Markdown → HTML for CMS publishing. Every piece of text is HTML-escaped;
 * links are kept only for http(s) URLs and site-relative paths (see markdown-ast).
 */
import { parseMarkdown, type Block, type Inline } from "./markdown-ast";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function inline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return escapeHtml(n.value);
      if (n.type === "code") return `<code>${escapeHtml(n.value)}</code>`;
      if (n.type === "link") return `<a href="${escapeHtml(n.href)}">${inline(n.children)}</a>`;
      return `<${n.type}>${inline(n.children)}</${n.type}>`;
    })
    .join("");
}

function render(b: Block): string {
  switch (b.type) {
    case "heading":
      return `<h${b.level}>${inline(b.children)}</h${b.level}>`;
    case "paragraph":
      return `<p>${inline(b.children)}</p>`;
    case "quote":
      return `<blockquote>${inline(b.children)}</blockquote>`;
    case "code":
      return `<pre><code>${escapeHtml(b.value)}</code></pre>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`;
    }
    case "table": {
      const head = b.head.map((c) => `<th>${inline(c)}</th>`).join("");
      const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  }
}

export function markdownToHtml(markdown: string): string {
  return parseMarkdown(markdown).map(render).join("\n");
}
