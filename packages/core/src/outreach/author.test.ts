import { describe, expect, it } from "vitest";
import { authorFromHtml } from "./author";

describe("authorFromHtml", () => {
  it("reads the author (and a published email) from Article JSON-LD", () => {
    const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Best tools","author":{"@type":"Person","name":"Dana Lee","email":"mailto:dana@example.org"}}</script></head></html>`;
    expect(authorFromHtml(html)).toEqual({ authorName: "Dana Lee", authorEmail: "dana@example.org", source: "json-ld" });
  });

  it("walks @graph and author arrays", () => {
    const html = `<script type='application/ld+json'>{"@graph":[{"@type":"WebPage"},{"@type":["Article","BlogPosting"],"author":[{"name":"Sam Ortiz"},{"name":"Kim Ng"}]}]}</script>`;
    expect(authorFromHtml(html)).toEqual({ authorName: "Sam Ortiz", authorEmail: null, source: "json-ld" });
  });

  it("falls back to meta author and rel=author bylines, decoding entities", () => {
    expect(authorFromHtml(`<meta content="Jos&eacute; &amp; Ana" name="author">`).authorName).toBe("José & Ana");
    expect(authorFromHtml(`<meta name="byl" content="By Priya Raman">`)).toEqual({ authorName: "Priya Raman", authorEmail: null, source: "meta" });
    expect(authorFromHtml(`<p>Written by <a rel="author" href="/u/x"><span>Lena Park</span></a></p>`)).toEqual({ authorName: "Lena Park", authorEmail: null, source: "byline" });
  });

  it("returns nothing when the page names no author (never guesses)", () => {
    expect(authorFromHtml(`<html><body><a href="mailto:privacy@site.com">Privacy</a></body></html>`)).toEqual({ authorName: null, authorEmail: null, source: null });
    // profile URLs are not names; broken JSON-LD is ignored
    expect(authorFromHtml(`<meta property="article:author" content="https://facebook.com/someone"><script type="application/ld+json">{bad</script>`).authorName).toBeNull();
    expect(authorFromHtml(`<meta name="author" content="${"x".repeat(300)}">`).authorName).toBeNull();
  });
});
