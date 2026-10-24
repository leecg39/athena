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
  it("translates CMS publishing outcomes without changing CMS names, ids or the CMS's own message", () => {
    const t = createTranslator("ko");
    expect(t("Webflow rejected the post (HTTP 400): Validation Error; slug taken")).toBe("Webflow이(가) 게시 요청을 거부했습니다 (HTTP 400): Validation Error; slug taken");
    expect(t("Contentful rejected publishing (HTTP 422): Validation error (required fields.summary). The draft created in Contentful was removed.")).toBe(
      "Contentful이(가) 게시를 거부했습니다 (HTTP 422): Validation error (required fields.summary). Contentful에 만든 초안은 삭제했습니다.",
    );
    expect(t("Wix rejected publishing (HTTP 403): Missing Post Owner. The draft 894a58a2 is still in Wix — publish or delete it there.")).toBe(
      "Wix이(가) 게시를 거부했습니다 (HTTP 403): Missing Post Owner. 초안 894a58a2이(가) Wix에 남아 있으니 그곳에서 게시하거나 삭제하세요.",
    );
    expect(t("Your Framer project has 2 unpublished page change(s). Publish or discard them in Framer first, so only this post goes live.")).toContain("2건");
    expect(t("Finish the Sanity connection first (missing: Project ID)")).toBe("먼저 Sanity 연결을 완료하세요 (누락: Project ID)");
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
