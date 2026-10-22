/** Helpers shared by onboarding and the Prompts workspace. */
import { and, eq, isNull, sql } from "drizzle-orm";
import { type Db, websites, organizations, topics, promptSchedules } from "@athena/db";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** Maximum live tracked prompts per website, by plan. */
export const PROMPT_LIMITS = { free: 50, starter: 500, enterprise: 5000 } as const;

export function isBrandedPrompt(text: string, brandName: string, domain: string): boolean {
  const t = text.toLowerCase();
  const label = domain.split(".")[0] ?? "";
  return t.includes(brandName.toLowerCase()) || (label.length >= 4 && t.includes(label.toLowerCase()));
}

export const cleanPromptText = (p: string): string => p.trim().replace(/\s+/g, " ");

/** Serialise writes that must respect per-website limits (SELECT … FOR UPDATE). */
export async function lockWebsite(tx: Tx, websiteId: string): Promise<void> {
  await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, websiteId)).for("update");
}

export async function promptLimitFor(db: DbOrTx, organizationId: string): Promise<number> {
  const [org] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, organizationId));
  return PROMPT_LIMITS[org?.plan ?? "free"];
}

/** Live topic with this name (case-insensitive), created if missing. */
export async function ensureTopic(db: DbOrTx, websiteId: string, name: string): Promise<string> {
  const [hit] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.websiteId, websiteId), isNull(topics.deletedAt), sql`lower(${topics.name}) = lower(${name})`));
  if (hit) return hit.id;
  const [row] = await db.insert(topics).values({ websiteId, name }).returning({ id: topics.id });
  return row.id;
}

export async function defaultScheduleId(db: DbOrTx, websiteId: string): Promise<string | null> {
  const [s] = await db
    .select({ id: promptSchedules.id })
    .from(promptSchedules)
    .where(and(eq(promptSchedules.websiteId, websiteId), eq(promptSchedules.kind, "default"), isNull(promptSchedules.archivedAt)));
  return s?.id ?? null;
}

/** Escape LIKE/ILIKE wildcards in user search text (used with `escape '\\'`). */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}
