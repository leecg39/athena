import { describe, expect, it } from "vitest";
import { parseCompetitorLines, parsePersonaLines, parseLines } from "./parse";

describe("onboarding form parsing", () => {
  it("parses competitor lines with or without a name", () => {
    expect(parseCompetitorLines("Figma, figma.com\n\n https://www.canva.com/ \nAdobe Express,adobe.com")).toEqual([
      { name: "Figma", domain: "figma.com" },
      { name: "Canva", domain: "https://www.canva.com/" },
      { name: "Adobe Express", domain: "adobe.com" },
    ]);
  });
  it("parses persona lines and keeps colons inside descriptions", () => {
    expect(parsePersonaLines("Designer: builds UI: daily\nPM")).toEqual([
      { name: "Designer", description: "builds UI: daily" },
      { name: "PM", description: "" },
    ]);
  });
  it("caps the number of lines", () => {
    expect(parseLines("a\nb\nc", 2)).toEqual(["a", "b"]);
  });
});
