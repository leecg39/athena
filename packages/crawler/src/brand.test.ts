import { describe, expect, it } from "vitest";
import { extractBrand } from "./brand";

const HTML = `<!doctype html><html lang="en-US"><head>
<title>Canvasly &amp; Co | AI design canvas for product teams</title>
<meta name="description" content="Design, prototype &amp; ship faster.">
<meta property="og:site_name" content="Canvasly">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Canvasly Inc.","sameAs":["https://twitter.com/canvasly"]}</script>
</head><body>
<h1>The AI-native  design canvas</h1>
<h2>Realtime collaboration</h2><h2>Design tokens</h2>
<script>var h1 = "<h1>not a heading</h1>";</script>
</body></html>`;

describe("extractBrand", () => {
  it("prefers og:site_name and decodes entities", () => {
    const b = extractBrand(HTML, "https://www.canvasly.io/");
    expect(b.name).toBe("Canvasly");
    expect(b.domain).toBe("canvasly.io");
    expect(b.description).toBe("Design, prototype & ship faster.");
    expect(b.language).toBe("en-US");
    expect(b.headlines).toEqual(["The AI-native design canvas"]);
    expect(b.productHints).toEqual(["Realtime collaboration", "Design tokens"]);
    expect(b.organizationName).toBe("Canvasly Inc.");
  });

  it("picks the title segment that matches the domain", () => {
    expect(extractBrand("<title>Home \\ Anthropic</title>", "https://www.anthropic.com/").name).toBe("Anthropic");
    expect(extractBrand("<title>Pricing – Linear</title>", "https://linear.app").name).toBe("Linear");
    expect(extractBrand("<title>Stripe: Financial Infrastructure</title>", "https://stripe.com").name).toBe("Stripe");
  });

  it("falls back to the title segment, then the domain", () => {
    expect(extractBrand("<title>Acme | Rockets</title>", "https://acme.dev").name).toBe("Acme");
    expect(extractBrand("<html></html>", "https://best-tools.example.com").name).toBe("Best Tools");
  });

  it("ignores malformed JSON-LD", () => {
    const b = extractBrand('<script type="application/ld+json">{bad json</script><title>X</title>', "https://x.io");
    expect(b.organizationName).toBeUndefined();
  });
});
