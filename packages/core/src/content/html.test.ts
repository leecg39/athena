import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./html";

describe("markdownToHtml", () => {
  it("renders the structure CMSs expect", () => {
    const html = markdownToHtml("# Title\n\nIntro with **bold**, *em* and `code`.\n\n- one\n- two\n\n1. first\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```\nx < y\n```");
    expect(html).toBe(
      "<h1>Title</h1>\n<p>Intro with <strong>bold</strong>, <em>em</em> and <code>code</code>.</p>\n<ul><li>one</li><li>two</li></ul>\n<ol><li>first</li></ol>\n<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>\n<blockquote>quote</blockquote>\n<pre><code>x &lt; y</code></pre>",
    );
  });

  it("escapes raw HTML and only links safe URLs", () => {
    expect(markdownToHtml('Hi <script>alert(1)</script> & "you"')).toBe("<p>Hi &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;you&quot;</p>");
    expect(markdownToHtml("[ok](https://a.example/x) [bad](javascript:alert(1)) [rel](/pricing)")).toBe(
      '<p><a href="https://a.example/x">ok</a> bad (javascript:alert(1)) <a href="/pricing">rel</a></p>',
    );
  });
});
