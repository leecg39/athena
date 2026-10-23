/**
 * Pitch email drafts grounded in verified data only: real citation stats,
 * confirmed Knowledge Base facts and the user's own angle. Missing facts become
 * explicit placeholders — the draft never asserts anything about the brand
 * that the workspace has not confirmed.
 */
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { type Db, outreachOpportunities, kbFacts, competitors } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError } from "../org/errors";
import { lockedOpportunity, toOpportunityRow, type OutreachOpportunityRow, type OutreachStatus } from "./shared";

export interface PitchContext {
  brand: string;
  brandDomain: string;
  opportunity: OutreachOpportunityRow;
  /** confirmed Knowledge Base claims */
  facts: string[];
  /** tracked competitor names (context for writers, never asserted in templates) */
  competitors: string[];
}

const ids = { actorId: z.string().uuid(), websiteId: z.string().uuid(), opportunityId: z.string().uuid() };
const draftText = z.string().trim().min(1, "The pitch email is empty").max(10_000, "Pitch emails are limited to 10,000 characters");

function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError(r.error.issues[0]?.message ?? "Invalid outreach request");
  return r.data;
}

export async function outreachPitchContext(db: Db, input: { actorId: string; websiteId: string; opportunityId: string }): Promise<PitchContext> {
  const data = parsed(z.object(ids), input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "content:write");
  const [row] = await db.select().from(outreachOpportunities).where(and(eq(outreachOpportunities.id, data.opportunityId), eq(outreachOpportunities.websiteId, site.id)));
  if (!row) throw new DomainError("Outreach opportunity not found");
  const [facts, comps] = await Promise.all([
    db.select({ claim: kbFacts.claim }).from(kbFacts).where(and(eq(kbFacts.websiteId, site.id), eq(kbFacts.status, "confirmed"), isNull(kbFacts.deletedAt))).orderBy(kbFacts.createdAt).limit(5),
    db.select({ name: competitors.name }).from(competitors).where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt))).orderBy(competitors.createdAt).limit(5),
  ]);
  return { brand: site.name, brandDomain: site.domain, opportunity: toOpportunityRow(row), facts: facts.map((f) => f.claim), competitors: comps.map((c) => c.name) };
}

const pctText = (v: number) => `${Number(v.toFixed(1))}%`;

/** A ready-to-edit draft built from the context only. */
export function templatePitchEmail(ctx: PitchContext, angle: string): string {
  const o = ctx.opportunity;
  const first = o.authorName?.trim().split(/\s+/)[0];
  const facts = ctx.facts.length
    ? [`A few verified facts about ${ctx.brand} that could help with an update:`, ...ctx.facts.slice(0, 3).map((f) => `- ${f}`)].join("\n")
    : `[Add 2-3 verified facts about ${ctx.brand} — confirm them in the Knowledge Base first]`;
  return [
    `Subject: ${ctx.brand} for your page on ${o.domain}`,
    `Hi ${first || "there"},`,
    `I came across ${o.url}. It is cited in ${pctText(o.citationPct)} of the AI answers we track for our category, so readers who ask AI assistants for recommendations often land on it.`,
    facts,
    angle.trim(),
    `Would you consider mentioning ${ctx.brand} (${ctx.brandDomain}) in a future update? Happy to answer any questions.`,
    `Best regards,\n[Your name]`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Stores a draft (written by the user, a model or the template) and moves a new card to "todo". */
export async function saveOutreachEmailDraft(
  db: Db,
  input: { actorId: string; websiteId: string; opportunityId: string; emailDraft: string; advanceToTodo?: boolean; source?: string },
): Promise<OutreachOpportunityRow> {
  const data = parsed(z.object({ ...ids, emailDraft: draftText }), input);
  const site = await requireWebsitePermission(db, data.actorId, data.websiteId, "content:write");
  return db.transaction(async (tx) => {
    const existing = await lockedOpportunity(tx, site.id, data.opportunityId);
    const status: OutreachStatus = input.advanceToTodo !== false && existing.status === "new" ? "todo" : existing.status;
    const [updated] = await tx.update(outreachOpportunities).set({ emailDraft: data.emailDraft, status }).where(eq(outreachOpportunities.id, existing.id)).returning();
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: data.actorId,
      websiteId: site.id,
      entityType: "outreach_opportunity",
      entityId: updated.id,
      change: "generated_email_draft",
      after: { domain: updated.domain, status: updated.status, source: input.source ?? "template" },
    });
    return toOpportunityRow(updated);
  });
}

/** Template draft from verified data (used when no AI writer is available). */
export async function generateOutreachEmailDraft(
  db: Db,
  input: { actorId: string; websiteId: string; opportunityId: string; angle?: string; advanceToTodo?: boolean },
): Promise<OutreachOpportunityRow> {
  const ctx = await outreachPitchContext(db, input);
  return saveOutreachEmailDraft(db, { ...input, emailDraft: templatePitchEmail(ctx, input.angle ?? ""), source: "template" });
}
