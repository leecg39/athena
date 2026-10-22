/**
 * robots.txt parsing and evaluation per RFC 9309:
 * groups of user-agent lines, exact (case-insensitive) product-token matching
 * with fallback to "*", longest-match rule precedence, allow wins ties,
 * and "*" / "$" path patterns.
 */
export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(body: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue; // rules before any user-agent are ignored
    if (key === "allow" || key === "disallow") {
      // an empty Disallow means "no restriction" — record nothing
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return { groups, sitemaps };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export interface RobotsVerdict {
  allowed: boolean;
  matchedGroup: string | null;
  rule: RobotsRule | null;
}

/** Decide whether `agent` (a product token, e.g. "GPTBot") may fetch `path`. */
export function evaluateRobots(parsed: ParsedRobots, agent: string, path: string): RobotsVerdict {
  const token = agent.toLowerCase();
  let applicable = parsed.groups.filter((g) => g.agents.includes(token));
  let matchedGroup: string | null = applicable.length ? agent : null;
  if (!applicable.length) {
    applicable = parsed.groups.filter((g) => g.agents.includes("*"));
    matchedGroup = applicable.length ? "*" : null;
  }
  const rules = applicable.flatMap((g) => g.rules);
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    const len = rule.pattern.replace(/\$$/, "").length;
    const bestLen = best ? best.pattern.replace(/\$$/, "").length : -1;
    if (len > bestLen || (len === bestLen && rule.allow && best && !best.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, matchedGroup, rule: best };
}
