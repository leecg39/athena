/** Responses browser: filtered answer list, prompt × model matrix, answer detail. */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type Db,
  responses,
  prompts,
  topics,
  responseMentions,
  responseCitations,
  attributeObservations,
  attributes,
  competitors,
  runs,
} from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { NotFoundError } from "../org/errors";
import { filtersSchema, responseConditions, responseFiltersSchema, type ResponseFilters } from "./filters";

export interface ResponseRow {
  id: string;
  ranAt: Date;
  model: string;
  provider: string | null;
  simulated: boolean;
  promptId: string;
  promptText: string;
  topicName: string | null;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  sentiment: string | null;
  sourcesCount: number;
  topDomains: string[];
  competitors: string[];
}

function parse(f: ResponseFilters): ResponseFilters {
  return { ...filtersSchema.parse(f), ...responseFiltersSchema.parse({ mentioned: f.mentioned, cited: f.cited, competitorId: f.competitorId, q: f.q || undefined }) };
}

export async function listResponses(
  db: Db,
  input: { actorId: string; websiteId: string; filters: ResponseFilters; limit?: number; offset?: number },
): Promise<{ rows: ResponseRow[]; total: number }> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return responsesForSite(db, site.id, input);
}

/** Answer list for a website the caller has ALREADY authorised (API keys). */
export async function responsesForSite(
  db: Db,
  websiteId: string,
  input: { filters: ResponseFilters; limit?: number; offset?: number },
): Promise<{ rows: ResponseRow[]; total: number }> {
  const f = parse(input.filters);
  const where = and(...responseConditions(websiteId, f));
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 1000);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: responses.id,
        ranAt: responses.ranAt,
        model: responses.model,
        provider: responses.provider,
        simulated: responses.simulated,
        promptId: prompts.id,
        promptText: prompts.text,
        topicName: topics.name,
        mentioned: responses.mentioned,
        cited: responses.cited,
        position: responses.position,
        sentiment: responses.sentiment,
      })
      .from(responses)
      .innerJoin(prompts, eq(prompts.id, responses.promptId))
      .leftJoin(topics, and(eq(topics.id, prompts.topicId), isNull(topics.deletedAt)))
      .where(where)
      .orderBy(desc(responses.ranAt), asc(responses.id))
      .limit(limit)
      .offset(input.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(responses).innerJoin(prompts, eq(prompts.id, responses.promptId)).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const [cites, mentions] = ids.length
    ? await Promise.all([
        db
          .select({ responseId: responseCitations.responseId, domain: responseCitations.domain, rank: responseCitations.rank })
          .from(responseCitations)
          .where(inArray(responseCitations.responseId, ids))
          .orderBy(asc(responseCitations.rank)),
        db
          .select({ responseId: responseMentions.responseId, name: competitors.name })
          .from(responseMentions)
          .innerJoin(competitors, eq(competitors.id, responseMentions.competitorId))
          .where(inArray(responseMentions.responseId, ids)),
      ])
    : [[], []];
  return {
    rows: rows.map((r) => {
      const own = cites.filter((c) => c.responseId === r.id);
      return {
        ...r,
        sourcesCount: own.length,
        topDomains: [...new Set(own.map((c) => c.domain))].slice(0, 3),
        competitors: [...new Set(mentions.filter((m) => m.responseId === r.id).map((m) => m.name))].sort(),
      };
    }),
    total: count?.n ?? 0,
  };
}

export interface MatrixCell {
  responseId: string;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  ranAt: Date;
}

export interface MatrixRow {
  promptId: string;
  promptText: string;
  cells: Record<string, MatrixCell>;
}

/** Latest answer per prompt × model inside the window. */
export async function responseMatrix(
  db: Db,
  input: { actorId: string; websiteId: string; filters: ResponseFilters },
): Promise<{ models: string[]; rows: MatrixRow[] }> {
  const f = parse(input.filters);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  const latest = await db
    .selectDistinctOn([responses.promptId, responses.model], {
      responseId: responses.id,
      promptId: prompts.id,
      promptText: prompts.text,
      model: responses.model,
      mentioned: responses.mentioned,
      cited: responses.cited,
      position: responses.position,
      ranAt: responses.ranAt,
    })
    .from(responses)
    .innerJoin(prompts, eq(prompts.id, responses.promptId))
    .where(and(...responseConditions(site.id, f)))
    .orderBy(responses.promptId, responses.model, desc(responses.ranAt), desc(responses.id));
  const models = [...new Set(latest.map((l) => l.model))].sort();
  const byPrompt = new Map<string, MatrixRow>();
  for (const l of latest) {
    const row = byPrompt.get(l.promptId) ?? { promptId: l.promptId, promptText: l.promptText, cells: {} };
    row.cells[l.model] = { responseId: l.responseId, mentioned: l.mentioned, cited: l.cited, position: l.position, ranAt: l.ranAt };
    byPrompt.set(l.promptId, row);
  }
  return { models, rows: [...byPrompt.values()].sort((a, b) => a.promptText.localeCompare(b.promptText)) };
}

export interface ResponseDetail extends Omit<ResponseRow, "sourcesCount" | "topDomains" | "competitors"> {
  rawText: string;
  runId: string | null;
  runTrigger: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  shoppingCard: unknown;
  mentions: { name: string; competitorId: string | null; sentiment: string | null; position: number | null }[];
  citations: { url: string; domain: string; rank: number; isBrand: boolean }[];
  observations: { attribute: string; competitorId: string | null; positive: boolean; textSpan: string }[];
}

export async function getResponseDetail(db: Db, input: { actorId: string; websiteId: string; responseId: string }): Promise<ResponseDetail> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  if (!/^[0-9a-f-]{36}$/i.test(input.responseId)) throw new NotFoundError("Response not found");
  const [r] = await db
    .select({
      id: responses.id,
      ranAt: responses.ranAt,
      model: responses.model,
      provider: responses.provider,
      simulated: responses.simulated,
      promptId: prompts.id,
      promptText: prompts.text,
      topicName: topics.name,
      mentioned: responses.mentioned,
      cited: responses.cited,
      position: responses.position,
      sentiment: responses.sentiment,
      rawText: responses.rawText,
      runId: responses.runId,
      runTrigger: runs.trigger,
      tokensIn: responses.tokensIn,
      tokensOut: responses.tokensOut,
      shoppingCard: responses.shoppingCard,
    })
    .from(responses)
    .innerJoin(prompts, eq(prompts.id, responses.promptId))
    .leftJoin(topics, eq(topics.id, prompts.topicId))
    .leftJoin(runs, eq(runs.id, responses.runId))
    .where(and(eq(responses.id, input.responseId), eq(responses.websiteId, site.id)));
  if (!r) throw new NotFoundError("Response not found");
  const [mentions, citations, observations] = await Promise.all([
    db
      .select({ name: responseMentions.name, competitorId: responseMentions.competitorId, sentiment: responseMentions.sentiment, position: responseMentions.position })
      .from(responseMentions)
      .where(eq(responseMentions.responseId, r.id)),
    db
      .select({ url: responseCitations.url, domain: responseCitations.domain, rank: responseCitations.rank, isBrand: responseCitations.isBrand })
      .from(responseCitations)
      .where(eq(responseCitations.responseId, r.id))
      .orderBy(asc(responseCitations.rank)),
    db
      .select({ attribute: attributes.name, competitorId: attributeObservations.competitorId, positive: attributeObservations.positive, textSpan: attributeObservations.textSpan })
      .from(attributeObservations)
      .innerJoin(attributes, eq(attributes.id, attributeObservations.attributeId))
      .where(eq(attributeObservations.responseId, r.id)),
  ]);
  return { ...r, mentions, citations, observations };
}
