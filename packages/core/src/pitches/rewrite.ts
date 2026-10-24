/**
 * Content rewrite for a pitch: the prospect's own page copy rewritten by the
 * configured AI provider to answer a buyer question directly. The writer may
 * only use facts stated in the copy (placeholders for anything missing).
 */
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { type Db, pitches } from "@athena/db";
import { requirePermission } from "../org/access";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { parsePitchPayload, type PitchPayload } from "./metrics";
import { toPitchItem, validateProspectUrl, type PitchItem } from "./pitch";

export type PitchRewriteWriter = (input: { brandName: string; domain: string; copy: string; focusPrompt: string | null }) => Promise<
  { ok: true; provider: string; afterCopy: string; faq: { question: string; answer: string }[] } | { ok: false; reason: "unavailable" | "failed" }
>;

const schema = z.object({
  pitchId: z.string().uuid("Invalid pitch ID"),
  existingCopy: z.string().trim().min(80, "Paste at least a paragraph of the prospect's current page copy").max(8000, "Keep the copy under 8,000 characters"),
  targetPageUrl: z.string().trim().max(500).optional(),
  focusPrompt: z.string().trim().max(240).optional(),
});

const faqSchema = z.array(z.object({ question: z.string().trim().min(3).max(200), answer: z.string().trim().min(1).max(600) })).max(6);

function targetUrl(raw: string | undefined, domain: string): string | null {
  if (!raw) return null;
  const { normalizedUrl, domain: host } = validateProspectUrl(raw);
  if (host !== domain && !host.endsWith(`.${domain}`)) throw new DomainError(`Use a page on the prospect's site (${domain})`);
  return normalizedUrl;
}

export async function writePitchRewrite(
  db: Db,
  input: { actorId: string; organizationId: string; writer: PitchRewriteWriter } & z.input<typeof schema>,
): Promise<PitchItem> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid rewrite request");
  await requirePermission(db, input.actorId, input.organizationId, "content:write");
  const [row] = await db.select().from(pitches).where(and(eq(pitches.id, parsed.data.pitchId), eq(pitches.organizationId, input.organizationId), isNull(pitches.deletedAt)));
  if (!row) throw new NotFoundError("Pitch not found");
  const payload = parsePitchPayload(row.payload);
  if (!payload) throw new DomainError("This pitch was made by an earlier version without measurements. Create a new pitch.");
  const page = targetUrl(parsed.data.targetPageUrl, payload.domain);
  const focusPrompt = parsed.data.focusPrompt || payload.prompts[0] || null;

  const written = await input.writer({ brandName: row.brandName, domain: payload.domain, copy: parsed.data.existingCopy, focusPrompt });
  if (!written.ok) {
    throw new DomainError(written.reason === "unavailable" ? "Rewrites are written by an AI provider, and none is configured." : "The AI provider could not write the rewrite. Try again.");
  }
  const faq = faqSchema.safeParse(written.faq);
  const next: PitchPayload = {
    ...payload,
    rewrite: { targetPageUrl: page, focusPrompt, beforeCopy: parsed.data.existingCopy, afterCopy: written.afterCopy.slice(0, 12_000), faq: faq.success ? faq.data : [], writtenBy: written.provider, writtenAt: new Date().toISOString() },
  };
  const [updated] = await db.update(pitches).set({ payload: next as unknown as Record<string, unknown> }).where(eq(pitches.id, row.id)).returning();
  await logActivity(db, { organizationId: input.organizationId, userId: input.actorId, entityType: "pitch", entityId: row.id, change: "rewrite_written", after: { provider: written.provider, targetPageUrl: page } });
  return toPitchItem(updated!);
}
