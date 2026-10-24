import { describe, expect, it } from "vitest";
import { parseMarkdown, inlineRuns } from "./markdown-ast";

describe("parseMarkdown", () => {
  it("parses blocks and nested inline formatting into one tree", () => {
    expect(parseMarkdown("## Hi **bold _em_** and [docs](https://d.example/a)\n\n- one\n- `two`\n\n1. first\n\n> said\n\n```\na < b\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |")).toEqual([
      {
        type: "heading",
        level: 2,
        children: [
          { type: "text", value: "Hi " },
          { type: "strong", children: [{ type: "text", value: "bold " }, { type: "em", children: [{ type: "text", value: "em" }] }] },
          { type: "text", value: " and " },
          { type: "link", href: "https://d.example/a", children: [{ type: "text", value: "docs" }] },
        ],
      },
      { type: "list", ordered: false, items: [[{ type: "text", value: "one" }], [{ type: "code", value: "two" }]] },
      { type: "list", ordered: true, items: [[{ type: "text", value: "first" }]] },
      { type: "quote", children: [{ type: "text", value: "said" }] },
      { type: "code", value: "a < b" },
      { type: "table", head: [[{ type: "text", value: "A" }], [{ type: "text", value: "B" }]], rows: [[[{ type: "text", value: "1" }], [{ type: "text", value: "2" }]]] },
    ]);
  });

  it("keeps unsafe links as plain text and site-relative links as links", () => {
    expect(parseMarkdown("[x](javascript:alert(1)) [y](/pricing) [z](//evil.example)")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "x (javascript:alert(1)" },
          { type: "text", value: ") " },
          { type: "link", href: "/pricing", children: [{ type: "text", value: "y" }] },
          { type: "text", value: " " },
          { type: "text", value: "z (//evil.example)" },
        ],
      },
    ]);
  });

  it("flattens inline trees into formatted runs, merging neighbours with the same format", () => {
    const [p] = parseMarkdown("a **b _c_** `d` [e **f**](https://e.example)") as [{ type: "paragraph"; children: never }];
    expect(inlineRuns(p.children)).toEqual([
      { text: "a ", marks: [], href: null },
      { text: "b ", marks: ["strong"], href: null },
      { text: "c", marks: ["strong", "em"], href: null },
      { text: " ", marks: [], href: null },
      { text: "d", marks: ["code"], href: null },
      { text: " ", marks: [], href: null },
      { text: "e ", marks: [], href: "https://e.example" },
      { text: "f", marks: ["strong"], href: "https://e.example" },
    ]);
    expect(inlineRuns([{ type: "text", value: "x" }, { type: "text", value: "y" }])).toEqual([{ text: "xy", marks: [], href: null }]);
  });
});
