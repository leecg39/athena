import { describe, expect, it } from "vitest";
import { detectShoppingCard, detectShoppingCards } from "./shopping";

describe("detectShoppingCards", () => {
  it("returns every priced product line in order, skipping subscription pricing", () => {
    const text = "Top picks:\n1. **Canvasly Sketch Kit** — $49 at Amazon\n2. **Figma Tablet Stand** — $35.50 at Best Buy\n3. Pro plan — $12 per month\n4. Wacom Pen — €79";
    expect(detectShoppingCards(text)).toEqual([
      { product: "Canvasly Sketch Kit", price: 49, currency: "USD", retailer: "Amazon", rank: 1 },
      { product: "Figma Tablet Stand", price: 35.5, currency: "USD", retailer: "Best Buy", rank: 2 },
      { product: "Wacom Pen", price: 79, currency: "EUR", rank: 3 },
    ]);
    expect(detectShoppingCard(text)).toEqual({ product: "Canvasly Sketch Kit", price: 49, currency: "USD", retailer: "Amazon", rank: 1 });
  });

  it("treats a lone priced line without a retailer as no shopping card", () => {
    expect(detectShoppingCards("The kit costs about — $49")).toEqual([]);
    expect(detectShoppingCard("The kit costs about — $49")).toBeNull();
  });
});
