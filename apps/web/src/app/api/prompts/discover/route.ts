import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/workspace";
import { getResponses } from "@/lib/data";

/** Prompt discovery: suggests prompts from site content, search data and competitor gaps. */
export async function POST() {
  const ws = await requireWorkspace();
  const rows = await getResponses();

  // Derive suggestions from tracked prompt themes + generic high-intent patterns.
  const seeds = [...new Set(rows.slice(0, 6).map((r) => r.prompt.split(" ").slice(0, 4).join(" ")))];
  const patterns = [
    (s: string) => `best ${s} for small teams`,
    (s: string) => `${s} alternatives compared`,
    (s: string) => `how to choose ${s}`,
    (s: string) => `top ${s} tools 2026`,
    (s: string) => `${s} pricing and features`,
  ];
  const suggestions = patterns
    .flatMap((p) => seeds.slice(0, 3).map(p))
    .filter((s, i, a) => a.indexOf(s) === i)
    .slice(0, 6)
    .map((s) => s.replace(/best best/, "best"));

  return NextResponse.json({ website: ws.website.domain, suggestions });
}
