import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, safeHref } from "./markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("never renders raw HTML from the model", () => {
    const out = html('Hello <img src=x onerror="alert(1)"> and <script>alert(1)</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });

  it("only links http(s) and app paths", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("/responses/abc")).toBe("/responses/abc");
    const out = html("[bad](javascript:alert(1)) [ext](https://example.com/a) [answer](/responses/abc)");
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer nofollow"');
    expect(out).toMatch(/<a href="\/responses\/abc" class="[^"]*">answer<\/a>/);
  });

  it("renders the formatting AI answers use", () => {
    const out = html(["## Summary", "", "Mention rate is **42%** and *rising*; see `get_visibility_metrics`.", "", "- one", "- two", "", "1. first", "2. second", "", "| Brand | Rate |", "|---|---|", "| Canvasly | 42% |", "", "```", "a < b", "```", "", "> quoted"].join("\n"));
    expect(out).toContain("<h3");
    expect(out).toContain("<strong>42%</strong>");
    expect(out).toContain("<em>rising</em>");
    expect(out).toContain("<code");
    expect(out).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    expect(out).toMatch(/<ol[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
    expect(out).toMatch(/<th[^>]*>Brand<\/th>/);
    expect(out).toMatch(/<td[^>]*>Canvasly<\/td>/);
    expect(out).toContain("a &lt; b");
    expect(out).toContain("<blockquote");
  });
});
