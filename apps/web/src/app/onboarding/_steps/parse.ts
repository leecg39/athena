/** Form text parsing for the onboarding wizard (pure, unit-tested). */

export function parseLines(text: string, max = 200): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** "Name, domain.com" or just "domain.com" per line. */
export function parseCompetitorLines(text: string): { name: string; domain: string }[] {
  return parseLines(text, 50).map((line) => {
    const comma = line.indexOf(",");
    if (comma === -1) {
      const label = line.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[./]/)[0] ?? line;
      return { name: label.charAt(0).toUpperCase() + label.slice(1), domain: line };
    }
    return { name: line.slice(0, comma).trim(), domain: line.slice(comma + 1).trim() };
  });
}

/** "Persona name: description" per line. */
export function parsePersonaLines(text: string): { name: string; description: string }[] {
  return parseLines(text, 10).map((line) => {
    const colon = line.indexOf(":");
    return colon === -1 ? { name: line, description: "" } : { name: line.slice(0, colon).trim(), description: line.slice(colon + 1).trim() };
  });
}
