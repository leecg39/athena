import { describe, expect, it } from "vitest";
import { mergeAttachments, validateTextFile, MAX_ATTACHMENTS, MAX_ATTACHMENT_CHARS } from "./attachments";

describe("validateTextFile", () => {
  it("accepts supported text extensions within size limits", () => {
    expect(validateTextFile("notes.md", "# Title\nHello")).toEqual({
      ok: true,
      attachment: { name: "notes.md", text: "# Title\nHello", size: 13 },
    });
    expect(validateTextFile("DATA.CSV", "a,b\n1,2")).toEqual({
      ok: true,
      attachment: { name: "DATA.CSV", text: "a,b\n1,2", size: 7 },
    });
  });

  it("rejects unsupported extensions, binary bytes and oversized files", () => {
    expect(validateTextFile("image.png", "abc")).toEqual({
      ok: false,
      error: "Only text files (TXT, MD, CSV, TSV, JSON) can be attached.",
    });
    expect(validateTextFile("bad.txt", "hello\u0000world")).toEqual({
      ok: false,
      error: "bad.txt looks like a binary file.",
    });
    expect(validateTextFile("huge.txt", "x".repeat(MAX_ATTACHMENT_CHARS + 1))).toEqual({
      ok: false,
      error: `huge.txt exceeds the ${MAX_ATTACHMENT_CHARS.toLocaleString("en-US")}-character limit.`,
    });
  });
});

describe("mergeAttachments", () => {
  it("enforces the maximum attachment count and replaces same-name files", () => {
    const a = { name: "a.txt", text: "1", size: 1 };
    const b = { name: "b.txt", text: "2", size: 1 };
    const c = { name: "c.txt", text: "3", size: 1 };
    const d = { name: "d.txt", text: "4", size: 1 };

    expect(mergeAttachments([a], [{ name: "a.txt", text: "updated", size: 7 }])).toEqual({
      attachments: [{ name: "a.txt", text: "updated", size: 7 }],
      error: null,
    });

    const over = mergeAttachments([a, b, c], [d]);
    expect(over.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(over.error).toMatch(/at most 3 files/i);
  });
});
