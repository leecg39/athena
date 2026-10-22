/** Source links in answer text (markdown + bare URLs), normalised and ranked. */
export interface ExtractedCitation {
  url: string;
  domain: string;
  rank: number;
  isBrand: boolean;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase();
  }
}

export function isBrandDomain(domain: string, brandDomain: string): boolean {
  const b = brandDomain.toLowerCase().replace(/^www\./, "");
  return domain === b || domain.endsWith(`.${b}`);
}

function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (!last) break;
    if (".,;:!?'\"*_>".includes(last)) url = url.slice(0, -1);
    else if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    else if (last === "]") url = url.slice(0, -1);
    else break;
  }
  return url;
}

export function extractCitations(text: string, brandDomain: string): ExtractedCitation[] {
  const found: { url: string; at: number }[] = [];
  for (const m of text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) found.push({ url: m[1], at: m.index! });
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) found.push({ url: trimUrl(m[0]), at: m.index! });
  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const out: ExtractedCitation[] = [];
  for (const f of found) {
    if (seen.has(f.url)) continue;
    try {
      new URL(f.url);
    } catch {
      continue;
    }
    seen.add(f.url);
    const domain = domainOf(f.url);
    out.push({ url: f.url, domain, rank: out.length, isBrand: isBrandDomain(domain, brandDomain) });
  }
  return out;
}
