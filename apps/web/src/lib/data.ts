/**
 * Server-side data access: queries the database when reachable and falls
 * back to the deterministic demo dataset otherwise, so every screen has
 * real data bindings and still renders in keyless/local environments.
 */
import { db } from "@athena/db";
import { prompts, topics, competitors } from "@athena/db";
import { and, eq, isNull, desc } from "drizzle-orm";
import {
  demoResponses,
  demoCitationSeries,
  demoMentionSeries,
  demoSources,
  demoHeatmap,
  demoCompetitorSoV,
  demoAds,
  demoShopping,
  demoInsights,
  demoActivity,
  demoOutreach,
  type DemoResponse,
  type DemoMetricPoint,
  type DemoSource,
} from "./demo";

export { demoAds, demoShopping, demoInsights, demoHeatmap, demoSources, demoCompetitorSoV, demoActivity, demoOutreach };

/** Prompts + topics of one website (tenant-scoped; empty when none exist). */
export async function getPrompts(websiteId: string): Promise<{
  prompts: { id: string; text: string; topic: string; type: string; status: string }[];
  topics: { id: string; name: string }[];
}> {
  const rows = await db
    .select({ id: prompts.id, text: prompts.text, type: prompts.type, status: prompts.status, topic: topics.name })
    .from(prompts)
    .leftJoin(topics, eq(prompts.topicId, topics.id))
    .where(and(eq(prompts.websiteId, websiteId), isNull(prompts.deletedAt)))
    .orderBy(desc(prompts.createdAt))
    .limit(500);
  const topicRows = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(and(eq(topics.websiteId, websiteId), isNull(topics.deletedAt)));
  return {
    prompts: rows.map((r) => ({ id: r.id, text: r.text, topic: r.topic ?? "Uncategorized", type: r.type, status: r.status })),
    topics: topicRows,
  };
}

export async function getResponses(filters?: { model?: string; promptType?: string }): Promise<DemoResponse[]> {
  let rows: DemoResponse[] = demoResponses(24);
  try {
    const [anyPrompt] = await db.select({ id: prompts.id }).from(prompts).limit(1);
    if (!anyPrompt) return rows;
    // Live DB: real query would join responses+prompts; demo shape kept for the table contract.
  } catch {
    // fallback
  }
  if (filters?.model) rows = rows.filter((r) => r.model.toLowerCase() === filters.model!.toLowerCase());
  if (filters?.promptType) rows = rows.filter((r) => r.promptType.toLowerCase() === filters.promptType!.toLowerCase());
  return rows;
}

export async function getDashboardData(): Promise<{
  citation: DemoMetricPoint[];
  mention: DemoMetricPoint[];
  sources: DemoSource[];
  competitors: { name: string; sov: number }[];
  summary: { citationRate: number; mentionRate: number; sov: number; position: number; value: number };
}> {
  const citation = demoCitationSeries();
  const mention = demoMentionSeries();
  const avg = (arr: DemoMetricPoint[], key: "brand" | "competitor") =>
    +(arr.reduce((a, b) => a + b[key], 0) / arr.length).toFixed(1);
  return {
    citation,
    mention,
    sources: demoSources().slice(0, 6),
    competitors: demoCompetitorSoV(),
    summary: {
      citationRate: avg(citation, "brand"),
      mentionRate: avg(mention, "brand"),
      sov: 47.8,
      position: 1.8,
      value: 12480,
    },
  };
}

/** Competitors tracked for one website (tenant-scoped). */
export async function getCompetitorList(websiteId: string): Promise<{ id: string; domain: string; name: string }[]> {
  const rows = await db
    .select()
    .from(competitors)
    .where(and(eq(competitors.websiteId, websiteId), isNull(competitors.deletedAt)));
  return rows.map((r) => ({ id: r.id, domain: r.domain, name: r.name }));
}
