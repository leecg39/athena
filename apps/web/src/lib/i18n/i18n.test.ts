import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createTranslator, DEFAULT_LOCALE, resolveLocale } from "@athena/i18n";
import ko from "../../../../../packages/i18n/src/ko.json";
import passthrough from "../../../../../packages/i18n/src/passthrough.json";

const root = path.resolve(__dirname, "../../../../..");

describe("language selection", () => {
  it("defaults to Korean and rejects unsupported cookie values", () => {
    expect(DEFAULT_LOCALE).toBe("ko");
    for (const value of [undefined, null, "", "KO", "fr", "<script>"]) expect(resolveLocale(value)).toBe("ko");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("ko")).toBe("ko");
  });
  it("renders both languages without losing whitespace or changing non-text values", () => {
    expect(createTranslator("ko")("  Save ")).toBe("  저장 ");
    expect(createTranslator("en")("  Save ")).toBe("  Save ");
    const data = { name: "Home", url: "https://example.com" };
    expect(createTranslator("ko")(data)).toBe(data);
    expect(createTranslator("ko")(null)).toBeNull();
    expect(createTranslator("ko")("My custom report 🚀")).toBe("My custom report 🚀");
    expect(createTranslator("ko")("constructor")).toBe("constructor");
  });
  it("substitutes parameters as literal data, including dollar signs and braces", () => {
    const brand = "Home $& {1} <brand>";
    expect(createTranslator("ko")("AI search visibility for {0}", { 0: brand })).toBe(`${brand}의 AI 검색 노출`);
    expect(createTranslator("en")("AI search visibility for {0}", { 0: brand })).toBe(`AI search visibility for ${brand}`);
  });
  it("translates catalogued server messages without changing names or domain strings", () => {
    expect(createTranslator("ko")('Pillar "Home" saved.')).toBe('지식 주제 “Home”을 저장했습니다.');
    expect(createTranslator("ko")("Rate limit reached. Try again in 12s.")).toBe("요청 한도에 도달했습니다. 12초 후 다시 시도하세요.");
    expect(createTranslator("en")('Pillar "Home" saved.')).toBe('Pillar "Home" saved.');
  });
  it("keeps parameter sets consistent across translated messages", () => {
    for (const [key, value] of Object.entries(ko)) {
      const slots = (s: string) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort();
      expect(slots(value), key).toEqual(slots(key));
    }
  });
});

describe("UI translation coverage", () => {
  it("catalogues every literal translation call across the app, marketing and docs", () => {
    const keys = new Set<string>();
    function visitDirectory(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { visitDirectory(file); continue; }
        if (file.includes(".test.")) continue;
        const source = readFileSync(file, "utf8");
        if (file.endsWith(".tsx")) {
          const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
          function visit(node: ts.Node) {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "tt" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text.trim());
            ts.forEachChild(node, visit);
          }
          visit(tree);
        } else if (file.endsWith(".astro")) {
          for (const match of source.matchAll(/\btt\(("(?:\\.|[^"\\])*")\)/g)) keys.add((JSON.parse(match[1]) as string).trim());
        }
      }
    }
    for (const app of ["web", "marketing", "docs"]) visitDirectory(path.join(root, "apps", app, "src"));
    const missing = [...keys].filter(key => /[a-zA-Z]/.test(key) && !Object.hasOwn(ko, key) && !passthrough.includes(key));
    expect(keys.size).toBeGreaterThan(1200);
    expect(missing).toEqual([]);
  });
});
