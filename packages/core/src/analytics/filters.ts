/** Shared WHERE-clause builder for answer analytics (Olympus, Responses, API). */
import { z } from "zod";
import { eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { responses, prompts, promptTagLinks, responseMentions } from "@athena/db";
import { escapeLike } from "../prompts/shared";

export interface VisibilityFilters {
  from: Date;
  to: Date;
  models?: string[];
  topicIds?: string[];
  personaIds?: string[];
  locationIds?: string[];
  tagIds?: string[];
  promptIds?: string[];
  promptType?: "branded" | "non_branded";
}

const uuidList = z.array(z.string().uuid()).max(200).optional();
export const filtersSchema = z
  .object({
    from: z.date(),
    to: z.date(),
    models: z.array(z.string().max(40)).max(20).optional(),
    topicIds: uuidList,
    personaIds: uuidList,
    locationIds: uuidList,
    tagIds: uuidList,
    promptIds: uuidList,
    promptType: z.enum(["branded", "non_branded"]).optional(),
  })
  .refine((f) => f.from < f.to, "from must be before to");


export function conditions(websiteId: string, f: VisibilityFilters): SQL[] {
  const c: SQL[] = [eq(responses.websiteId, websiteId), gte(responses.ranAt, f.from), lt(responses.ranAt, f.to), isNull(prompts.deletedAt)];
  if (f.models?.length) c.push(inArray(responses.model, f.models));
  if (f.topicIds?.length) c.push(inArray(prompts.topicId, f.topicIds));
  if (f.personaIds?.length) c.push(inArray(prompts.personaId, f.personaIds));
  if (f.locationIds?.length) c.push(inArray(prompts.locationId, f.locationIds));
  if (f.promptIds?.length) c.push(inArray(prompts.id, f.promptIds));
  if (f.promptType) c.push(eq(prompts.type, f.promptType));
  if (f.tagIds?.length) {
    // raw EXISTS (drizzle's exists() does not parenthesise raw sql fragments)
    c.push(sql`exists (select 1 from ${promptTagLinks} where ${promptTagLinks.promptId} = ${prompts.id} and ${inArray(promptTagLinks.tagId, f.tagIds)})`);
  }
  return c;
}

/** Extra answer-level filters for the Responses browser. */
export interface ResponseFilters extends VisibilityFilters {
  mentioned?: boolean;
  cited?: boolean;
  competitorId?: string;
  /** case-insensitive search in prompt text or answer text (wildcards escaped) */
  q?: string;
}

export const responseFiltersSchema = z.object({
  mentioned: z.boolean().optional(),
  cited: z.boolean().optional(),
  competitorId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
});

export function responseConditions(websiteId: string, f: ResponseFilters): SQL[] {
  const c = conditions(websiteId, f);
  if (f.mentioned !== undefined) c.push(eq(responses.mentioned, f.mentioned));
  if (f.cited !== undefined) c.push(eq(responses.cited, f.cited));
  if (f.competitorId) {
    c.push(sql`exists (select 1 from ${responseMentions} where ${responseMentions.responseId} = ${responses.id} and ${responseMentions.competitorId} = ${f.competitorId})`);
  }
  if (f.q) {
    const pattern = `%${escapeLike(f.q)}%`;
    c.push(or(sql`${prompts.text} ilike ${pattern} escape '\\'`, sql`${responses.rawText} ilike ${pattern} escape '\\'`) as SQL);
  }
  return c;
}
