import { describe, expect, it } from "vitest";
import { parseResponsesState, responsesFilters, responsesQuery } from "./responses-state";

describe("responses state", () => {
  it("parses yes/no, uuid and paging defensively and round-trips", () => {
    const s = parseResponsesState({ range: "7d", mentioned: "no", cited: "maybe", competitorId: "x", q: "  best tools  ", view: "matrix", page: "-3" });
    expect(s).toMatchObject({ mentioned: false, cited: undefined, competitorId: undefined, q: "best tools", view: "matrix", page: 1 });
    const again = parseResponsesState(Object.fromEntries(new URLSearchParams(responsesQuery(s))));
    expect(again).toEqual(s);
    expect(responsesQuery(s, { page: 3 })).toContain("page=3");
  });
  it("builds response filters for the selected window", () => {
    const f = responsesFilters(parseResponsesState({ range: "7d", mentioned: "yes" }), new Date("2026-10-22T00:00:00Z"));
    expect(f.mentioned).toBe(true);
    expect(f.from.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });
});
