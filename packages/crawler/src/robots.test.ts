import { describe, expect, it } from "vitest";
import { evaluateRobots, parseRobots } from "./robots";

const TXT = `
# comment
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
User-agent: PerplexityBot
Disallow: /private
Allow: /private/public-page

User-agent: *
Disallow: /admin
Disallow: /*.pdf$

Sitemap: https://example.com/sitemap.xml
`;

describe("robots", () => {
  const rules = parseRobots(TXT);

  it("collects sitemaps", () => {
    expect(rules.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("applies the group matching the product token, else *", () => {
    expect(evaluateRobots(rules, "GPTBot", "/").allowed).toBe(false);
    expect(evaluateRobots(rules, "gptbot", "/blog").allowed).toBe(false);
    expect(evaluateRobots(rules, "ClaudeBot", "/").allowed).toBe(true);
    expect(evaluateRobots(rules, "OAI-SearchBot", "/").allowed).toBe(true);
    expect(evaluateRobots(rules, "OAI-SearchBot", "/admin/x").allowed).toBe(false);
  });

  it("does not let a group header that merely contains the token match (no substring match)", () => {
    const r = parseRobots("User-agent: Bot\nDisallow: /\n");
    expect(evaluateRobots(r, "GPTBot", "/").allowed).toBe(true);
  });

  it("uses longest-match with allow winning ties", () => {
    expect(evaluateRobots(rules, "PerplexityBot", "/private/x").allowed).toBe(false);
    expect(evaluateRobots(rules, "PerplexityBot", "/private/public-page").allowed).toBe(true);
    const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a\n");
    expect(evaluateRobots(tie, "x", "/a").allowed).toBe(true);
  });

  it("supports * and $ patterns", () => {
    expect(evaluateRobots(rules, "AnyBot", "/docs/file.pdf").allowed).toBe(false);
    expect(evaluateRobots(rules, "AnyBot", "/docs/file.pdf?x=1").allowed).toBe(true);
  });

  it("treats an empty Disallow as allow-all and missing groups as allowed", () => {
    expect(evaluateRobots(parseRobots("User-agent: *\nDisallow:\n"), "GPTBot", "/").allowed).toBe(true);
    expect(evaluateRobots(parseRobots(""), "GPTBot", "/").allowed).toBe(true);
  });
});
