import { describe, expect, it } from "vitest";
import { extract, findMentions, aliasesFor, extractCitations, detectShoppingCard, domainOf } from "./index";

const comps = [
  { id: "f", name: "Figma", domain: "figma.com" },
  { id: "c", name: "Canvasly", domain: "canvasly.io" },
];

describe("findMentions", () => {
  it("matches whole words only, case-insensitively, including the domain", () => {
    expect(findMentions("Canvasly beats it", ["Canva", "canva.com"])).toEqual([]);
    expect(findMentions("I like canva, and Canva's templates. See canva.com.", ["Canva", "canva.com"]).length).toBe(3);
    expect(findMentions("Großartig: Notion-ähnlich", ["Notion"]).length).toBe(1);
  });
  it("does not treat a parent-company domain label as a multi-word brand", () => {
    const aliases = aliasesFor("Adobe Express", "adobe.com");
    expect(findMentions("Adobe Photoshop is popular", aliases)).toEqual([]);
    expect(findMentions("Try Adobe Express or adobe.com", aliases).length).toBe(2);
    expect(aliasesFor("Vercel", "vercel.com")).toContain("vercel");
  });

  it("ignores names that only appear inside URLs", () => {
    expect(findMentions("Read https://www.g2.com/products/canvasly/reviews today", ["Canvasly"])).toEqual([]);
  });
});

describe("extract", () => {
  const list = "Top picks:\n1. Figma — industry standard.\n2. Canvasly — not the best for beginners, but powerful.\n3. Canva — easy to use.\n";

  it("uses the list rank as position and does not confuse similar names", () => {
    const r = extract({ rawText: list, brandName: "Canva", brandDomain: "canva.com", competitors: comps, attributes: [] });
    expect(r.mentioned).toBe(true);
    expect(r.position).toBe(3);
    expect(r.mentions.map((m) => [m.name, m.position])).toEqual([
      ["Canva", 3],
      ["Figma", 1],
      ["Canvasly", 2],
    ]);
  });

  it("scores sentiment per entity with negation and contrast", () => {
    const r = extract({ rawText: list, brandName: "Canva", brandDomain: "canva.com", competitors: comps, attributes: [] });
    const s = Object.fromEntries(r.mentions.map((m) => [m.name, m.sentiment]));
    expect(s).toEqual({ Canva: "positive", Figma: "positive", Canvasly: "mixed" });
    const neg = extract({ rawText: "Acme is expensive and not easy to use. Figma is great.", brandName: "Acme", brandDomain: "acme.com", competitors: comps, attributes: [] });
    expect(neg.sentiment).toBe("negative");
    expect(neg.mentions.find((m) => m.name === "Figma")?.sentiment).toBe("positive");
  });

  it("falls back to mention order without a list and reports unmentioned brands", () => {
    const r = extract({ rawText: "Figma and Canvasly are common. Canva also works.", brandName: "Canva", brandDomain: "canva.com", competitors: comps, attributes: [] });
    expect(r.position).toBe(3);
    const none = extract({ rawText: "Use Figma.", brandName: "Canva", brandDomain: "canva.com", competitors: comps, attributes: [] });
    expect(none).toMatchObject({ mentioned: false, position: null, sentiment: "unknown" });
  });

  it("attributes observations to the nearest entity in the sentence", () => {
    const r = extract({
      rawText: "Canva is easy to use, while Figma is expensive. Canvasly is not expensive.",
      brandName: "Canva",
      brandDomain: "canva.com",
      competitors: comps,
      attributes: ["easy to use", "expensive"],
    });
    expect(r.observations.map((o) => [o.attribute, o.competitorId, o.positive])).toEqual([
      ["easy to use", null, true],
      ["expensive", "f", true],
      ["expensive", "c", false],
    ]);
  });
});

describe("extractCitations", () => {
  it("collects markdown and bare links in order, trimming punctuation and dedupe", () => {
    const c = extractCitations("See [G2](https://www.g2.com/x) and https://reddit.com/r/design). Also (https://g2.com/x) and https://www.g2.com/x.", "canva.com");
    expect(c.map((x) => [x.url, x.domain, x.rank])).toEqual([
      ["https://www.g2.com/x", "g2.com", 0],
      ["https://reddit.com/r/design", "reddit.com", 1],
      ["https://g2.com/x", "g2.com", 2],
    ]);
    expect(extractCitations("https://blog.canva.com/a", "canva.com")[0].isBrand).toBe(true);
    expect(extractCitations("https://notcanva.com/a", "canva.com")[0].isBrand).toBe(false);
  });
  it("domainOf strips www and lowercases", () => {
    expect(domainOf("https://WWW.Example.COM/a")).toBe("example.com");
  });
});

describe("detectShoppingCard", () => {
  it("finds product listings with a price and retailer", () => {
    expect(detectShoppingCard("1. Sony WH-1000XM5 — $348 at Amazon\n2. Bose QC Ultra — $429 at Best Buy")).toEqual({
      product: "Sony WH-1000XM5",
      price: 348,
      currency: "USD",
      retailer: "Amazon",
      rank: 1,
    });
  });
  it("ignores subscription pricing and prose", () => {
    expect(detectShoppingCard("Pricing - $12 per month on most plans.")).toBeNull();
    expect(detectShoppingCard("The Pro plan costs $20/mo per user.")).toBeNull();
  });
});
