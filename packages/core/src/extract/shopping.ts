/** Conservative product-listing (AI shopping card) detection. */
export interface ShoppingCard {
  product: string;
  price: number;
  currency: string;
  retailer?: string;
  rank: number;
}

const LINE = /^[ \t]*(?:(\d{1,2})[.)]|[-*•])?[ \t]*\**([^\n$€£]{2,80}?)\**[ \t]*[—–:-][ \t]*(?:from[ \t]+)?(\$|€|£|USD ?|EUR ?|GBP ?)(\d[\d,]*(?:\.\d{1,2})?)(?:[ \t]+(?:at|from|on|via)[ \t]+([A-Z][\w&.' -]{1,40}?))?[ \t.]*$/gm;
const SUBSCRIPTION = /\b(?:per|a|\/)\s*(?:month|mo|year|yr|user|seat)\b|\/(?:mo|month|yr|year)\b|\bmonthly\b|\bannual(?:ly)?\b|\bsubscription\b|\bplans?\b|\bpricing\b/i;
const CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", USD: "USD", EUR: "EUR", GBP: "GBP" };

export function detectShoppingCard(text: string): ShoppingCard | null {
  const cards: ShoppingCard[] = [];
  for (const m of text.matchAll(LINE)) {
    if (SUBSCRIPTION.test(m[0])) continue;
    const price = Number.parseFloat(m[4].replace(/,/g, ""));
    if (!Number.isFinite(price)) continue;
    cards.push({
      product: m[2].trim(),
      price,
      currency: CURRENCY[m[3].trim()] ?? "USD",
      retailer: m[5]?.trim() || undefined,
      rank: cards.length + 1,
    });
  }
  // a single priced line without a retailer is too weak a signal
  if (!cards.length || (cards.length === 1 && !cards[0].retailer)) return null;
  const { retailer, ...rest } = cards[0];
  return retailer ? { ...rest, retailer } : rest;
}
