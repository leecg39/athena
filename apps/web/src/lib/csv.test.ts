import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("csv", () => {
  it("quotes separators and neutralises formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvRow(["a", 1, "x\ny"])).toBe('a,1,"x\ny"');
  });
});
