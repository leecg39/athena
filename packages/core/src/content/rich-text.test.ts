import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown-ast";
import { toContentfulRichText, toLexical, toPortableText } from "./rich-text";

const SAMPLE = "## Plan\n\nUse **tokens** and [docs](https://d.example).\n\n- one\n- *two*\n\n> note\n\n```\na\nb\n```\n\n| A | B |\n|---|---|\n| 1 |";

describe("Sanity Portable Text", () => {
  it("renders styles, list items, decorators and link annotations with unique keys", () => {
    const blocks = toPortableText(parseMarkdown(SAMPLE));
    expect(blocks[0]).toEqual({ _type: "block", _key: "b0", style: "h2", markDefs: [], children: [{ _type: "span", _key: "b0s0", text: "Plan", marks: [] }] });
    expect(blocks[1]).toEqual({
      _type: "block",
      _key: "b1",
      style: "normal",
      markDefs: [{ _type: "link", _key: "b1l0", href: "https://d.example" }],
      children: [
        { _type: "span", _key: "b1s0", text: "Use ", marks: [] },
        { _type: "span", _key: "b1s1", text: "tokens", marks: ["strong"] },
        { _type: "span", _key: "b1s2", text: " and ", marks: [] },
        { _type: "span", _key: "b1s3", text: "docs", marks: ["b1l0"] },
        { _type: "span", _key: "b1s4", text: ".", marks: [] },
      ],
    });
    expect(blocks.slice(2, 4).map((b) => [b._key, b.listItem, b.level, b.children.map((c) => [c.text, c.marks])])).toEqual([
      ["b2i0", "bullet", 1, [["one", []]]],
      ["b2i1", "bullet", 1, [["two", ["em"]]]],
    ]);
    expect(blocks[4]).toMatchObject({ style: "blockquote", children: [{ text: "note" }] });
    expect(blocks[5]).toMatchObject({ style: "normal", children: [{ text: "a\nb", marks: ["code"] }] });
    // tables have no standard Portable Text type: one line per row, header in bold
    expect(blocks.slice(6).map((b) => b.children.map((c) => [c.text, c.marks]))).toEqual([
      [["A", ["strong"]], [" | ", []], ["B", ["strong"]]],
      [["1", []]],
    ]);
    expect(new Set(blocks.map((b) => b._key)).size).toBe(blocks.length);
  });

  it("never emits an empty block", () => {
    expect(toPortableText(parseMarkdown("#  "))).toEqual([{ _type: "block", _key: "b0", style: "h1", markDefs: [], children: [{ _type: "span", _key: "b0s0", text: "", marks: [] }] }]);
  });
});

describe("Contentful Rich Text", () => {
  it("follows the node nesting rules (list items, quotes and cells hold paragraphs)", () => {
    const doc = toContentfulRichText(parseMarkdown(SAMPLE));
    expect(doc.nodeType).toBe("document");
    const [h, p, ul, quote, code, table] = doc.content as any[];
    expect(h).toEqual({ nodeType: "heading-2", data: {}, content: [{ nodeType: "text", value: "Plan", marks: [], data: {} }] });
    expect(p.content).toEqual([
      { nodeType: "text", value: "Use ", marks: [], data: {} },
      { nodeType: "text", value: "tokens", marks: [{ type: "bold" }], data: {} },
      { nodeType: "text", value: " and ", marks: [], data: {} },
      { nodeType: "hyperlink", data: { uri: "https://d.example" }, content: [{ nodeType: "text", value: "docs", marks: [], data: {} }] },
      { nodeType: "text", value: ".", marks: [], data: {} },
    ]);
    expect(ul.nodeType).toBe("unordered-list");
    expect(ul.content[1]).toEqual({ nodeType: "list-item", data: {}, content: [{ nodeType: "paragraph", data: {}, content: [{ nodeType: "text", value: "two", marks: [{ type: "italic" }], data: {} }] }] });
    expect(quote).toEqual({ nodeType: "blockquote", data: {}, content: [{ nodeType: "paragraph", data: {}, content: [{ nodeType: "text", value: "note", marks: [], data: {} }] }] });
    expect(code).toEqual({ nodeType: "paragraph", data: {}, content: [{ nodeType: "text", value: "a\nb", marks: [{ type: "code" }], data: {} }] });
    expect(table.nodeType).toBe("table");
    expect(table.content.map((row: any) => row.content.map((c: any) => [c.nodeType, c.content[0].nodeType, c.content[0].content[0].value]))).toEqual([
      [["table-header-cell", "paragraph", "A"], ["table-header-cell", "paragraph", "B"]],
      // short rows are padded so every row has the header's cells
      [["table-cell", "paragraph", "1"], ["table-cell", "paragraph", ""]],
    ]);
  });

  it("is a valid document even for an empty draft", () => {
    expect(toContentfulRichText([])).toEqual({ nodeType: "document", data: {}, content: [{ nodeType: "paragraph", data: {}, content: [{ nodeType: "text", value: "", marks: [], data: {} }] }] });
  });
});

describe("Payload Lexical", () => {
  it("serializes the editor state Payload's Lexical field stores", () => {
    const state = toLexical(parseMarkdown(SAMPLE));
    expect(state.root).toMatchObject({ type: "root", format: "", indent: 0, version: 1, direction: "ltr" });
    const [h, p, list, quote, code] = state.root.children as any[];
    const text = (t: string, format = 0) => ({ type: "text", text: t, format, detail: 0, mode: "normal", style: "", version: 1 });
    expect(h).toEqual({ type: "heading", tag: "h2", children: [text("Plan")], direction: "ltr", format: "", indent: 0, version: 1 });
    expect(p.type).toBe("paragraph");
    expect(p.children).toEqual([
      text("Use "),
      text("tokens", 1),
      text(" and "),
      { type: "link", fields: { url: "https://d.example", newTab: false, linkType: "custom" }, children: [text("docs")], direction: "ltr", format: "", indent: 0, version: 3 },
      text("."),
    ]);
    expect(list).toMatchObject({ type: "list", listType: "bullet", tag: "ul", start: 1 });
    expect(list.children.map((li: any) => [li.type, li.value, li.children])).toEqual([
      ["listitem", 1, [text("one")]],
      ["listitem", 2, [text("two", 2)]],
    ]);
    expect(quote).toMatchObject({ type: "quote", children: [text("note")] });
    expect(code.children).toEqual([text("a", 16), { type: "linebreak", version: 1 }, text("b", 16)]);
  });
});
