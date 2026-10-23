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

/** Every priced product line of an answer, in order (subscription pricing excluded). */
export function detectShoppingCards(text: string): ShoppingCard[] {
  const lines = [...text.matchAll(LINE)].filter((m) => !SUBSCRIPTION.test(m[0]) && Number.isFinite(Number.parseFloat(m[4].replace(/,/g, ""))));
  const cards = lines.map((m, i): ShoppingCard => {
    const retailer = m[5]?.trim();
    const card = { product: m[2].trim(), price: Number.parseFloat(m[4].replace(/,/g, "")), currency: CURRENCY[m[3].trim()] ?? "USD", rank: i + 1 };
    return retailer ? { ...card, retailer } : card;
  });
  // a single priced line without a retailer is too weak a signal
  return cards.length === 1 && !cards[0].retailer ? [] : cards;
}

/** The first card of an answer's product listing (stored on the response). */
export function detectShoppingCard(text: string): ShoppingCard | null {
  return detectShoppingCards(text)[0] ?? null;
}
