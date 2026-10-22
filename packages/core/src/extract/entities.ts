/** Brand/competitor mention detection with whole-word matching. */
import { findAll, maskUrls, mergeSpans, type Span } from "./text";

/** Aliases for an entity: its name, its domain, and the domain label when distinctive. */
export function aliasesFor(name: string, domain?: string): string[] {
  const set = new Set<string>([name.trim()]);
  if (domain) {
    set.add(domain);
    const label = domain.split(".")[0] ?? "";
    // for multi-word brands ("Adobe Express" on adobe.com) the label names the parent company
    if (label.length >= 5 && !/\s/.test(name.trim())) set.add(label);
  }
  return [...set].filter(Boolean);
}

/** Mention spans of any alias, ignoring text inside URLs; overlapping hits count once. */
export function findMentions(text: string, aliases: string[]): Span[] {
  const masked = maskUrls(text);
  return mergeSpans(aliases.flatMap((a) => findAll(masked, a)));
}
