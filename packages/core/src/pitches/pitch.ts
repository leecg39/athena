/**
 * Pitch Workspace (Task 19): shareable AI-search audits of a prospect's site,
 * measured from AI answers collected for the prospect's buyer questions with
 * the configured providers (1 credit per answer, failures refunded).
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { type Db, organizations, pitches } from "@athena/db";
import { requireMember, requirePermission } from "../org/access";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { getOrgBalance, refundCredits, reserveCredits } from "../billing/credits";
import { computePitchPayload, parsePitchPayload, type CollectedPitchAnswer, type PitchPayload } from "./metrics";

export const PITCH_KINDS = ["visibility", "content"] as const;
export type PitchKind = (typeof PITCH_KINDS)[number];

export const PITCH_MONTHLY_LIMITS: Record<"free" | "starter" | "enterprise", number> = { free: 3, starter: 10, enterprise: 100 };
export const MAX_PITCH_PROMPTS = 5;
export const MAX_PITCH_COMPETITORS = 5;
const COLLECT_TIMEOUT_MS = 60_000;

/** A search adapter (structurally compatible with @athena/llm's SearchAdapter). */
export interface PitchCollector {
  readonly model: string;
  collect(prompt: string, opts?: { country?: string; entities?: string[] }): Promise<{ text: string; citations: { url: string; domain?: string }[]; provider: string; simulated?: boolean }>;
}

export interface PitchItem {
  id: string;
  organizationId: string;
  websiteUrl: string;
  brandName: string;
  domain: string;
  shareId: string;
  sharePath: string;
  kind: PitchKind;
  /** null for pitches made by earlier versions, which held no measurements */
  payload: PitchPayload | null;
  createdAt: Date;
}

export interface PitchUsageSummary {
  plan: "free" | "starter" | "enterprise";
  usedThisMonth: number;
  monthlyLimit: number;
  remaining: number;
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/i,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd00:/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\.google\.internal$/i,
];

export function validateProspectUrl(rawUrl: string): {
  normalizedUrl: string;
  domain: string;
  inferredBrandName: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new DomainError("Prospect website URL is required");
  }
  if (/^(javascript|data|file|ftp|mailto|vbscript):/i.test(trimmed)) {
    throw new DomainError("Prospect website URL must use http:// or https://");
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new DomainError("Invalid prospect website URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DomainError("Prospect website URL must use http:// or https://");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !hostname ||
    !hostname.includes(".") ||
    PRIVATE_HOST_PATTERNS.some((re) => re.test(hostname) || re.test(parsed.hostname))
  ) {
    throw new DomainError("Prospect URL must be a public domain (private/loopback hosts are blocked)");
  }

  const rootPart = hostname.split(".")[0] ?? "brand";
  const inferredBrandName =
    rootPart.charAt(0).toUpperCase() + rootPart.slice(1).replace(/[-_]+/g, " ");

  const cleanPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  const normalizedUrl = `${parsed.protocol}//${hostname}${cleanPath}`;

  return {
    normalizedUrl,
    domain: hostname,
    inferredBrandName,
  };
}

export function toPitchItem(row: typeof pitches.$inferSelect): PitchItem {
  const kind: PitchKind = row.kind === "content" ? "content" : "visibility";
  const payload = parsePitchPayload(row.payload);
  return {
    id: row.id,
    organizationId: row.organizationId,
    websiteUrl: row.websiteUrl,
    brandName: row.brandName,
    domain: payload?.domain ?? row.websiteUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, ""),
    shareId: row.shareId,
    sharePath: kind === "content" ? `/report/content/${row.shareId}` : `/report/${row.shareId}`,
    kind,
    payload,
    createdAt: row.createdAt,
  };
}

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Pitches created this month count against the plan, including deleted ones. */
async function usage(db: Db, organizationId: string): Promise<PitchUsageSummary> {
  const [org] = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, organizationId));
  if (!org) throw new NotFoundError("Organization not found");
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(pitches).where(and(eq(pitches.organizationId, organizationId), gte(pitches.createdAt, monthStart())));
  const used = Number(row?.n ?? 0);
  const limit = PITCH_MONTHLY_LIMITS[org.plan] ?? 3;
  return { plan: org.plan, usedThisMonth: used, monthlyLimit: limit, remaining: Math.max(0, limit - used) };
}

export async function getPitchUsage(db: Db, opts: { actorId: string; organizationId: string }): Promise<PitchUsageSummary> {
  await requireMember(db, opts.actorId, opts.organizationId);
  return usage(db, opts.organizationId);
}

export async function listPitches(db: Db, opts: { actorId: string; organizationId: string; kind?: PitchKind }): Promise<PitchItem[]> {
  await requireMember(db, opts.actorId, opts.organizationId);
  const where = [eq(pitches.organizationId, opts.organizationId), isNull(pitches.deletedAt), ...(opts.kind ? [eq(pitches.kind, opts.kind)] : [])];
  const rows = await db.select().from(pitches).where(and(...where)).orderBy(desc(pitches.createdAt), desc(pitches.id));
  return rows.map(toPitchItem);
}

const createSchema = z.object({
  websiteUrl: z.string().trim().min(3, "Prospect website URL is required").max(500),
  brandName: z.string().trim().max(120).optional(),
  kind: z.enum(PITCH_KINDS).default("visibility"),
  industry: z.string().trim().max(120).optional(),
  prompts: z.array(z.string().trim().min(3, "Each buyer question needs at least 3 characters").max(240)).min(1, "Add at least one buyer question for the AI models to answer").max(MAX_PITCH_PROMPTS, `Use at most ${MAX_PITCH_PROMPTS} buyer questions`),
  competitors: z.array(z.string().trim().min(2).max(80)).max(MAX_PITCH_COMPETITORS, `Use at most ${MAX_PITCH_COMPETITORS} competitors`).default([]),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
});

type Job = { prompt: string; collector: PitchCollector };
type JobResult = { ok: true; answer: CollectedPitchAnswer } | { ok: false; prompt: string; model: string };

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);

async function runJob(job: Job, opts: { entities: string[]; country?: string }): Promise<JobResult> {
  try {
    const a = await withTimeout(job.collector.collect(job.prompt, opts), COLLECT_TIMEOUT_MS);
    return { ok: true, answer: { prompt: job.prompt, model: job.collector.model, text: a.text, citations: a.citations, provider: a.provider, simulated: a.simulated } };
  } catch {
    return { ok: false, prompt: job.prompt, model: job.collector.model };
  }
}

/** Providers run in parallel; each provider answers two questions at a time. */
async function collectAll(prompts: string[], collectors: PitchCollector[], opts: { entities: string[]; country?: string }): Promise<JobResult[]> {
  const perCollector = collectors.map(async (collector) => {
    const pairs = Array.from({ length: Math.ceil(prompts.length / 2) }, (_, i) => prompts.slice(i * 2, i * 2 + 2));
    return pairs.reduce<Promise<JobResult[]>>(async (acc, pair) => [...(await acc), ...(await Promise.all(pair.map((prompt) => runJob({ prompt, collector }, opts))))], Promise.resolve([]));
  });
  return (await Promise.all(perCollector)).flat();
}

const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];

export async function createPitch(
  db: Db,
  input: { actorId: string; organizationId: string; collectors: PitchCollector[]; now?: Date } & z.input<typeof createSchema>,
): Promise<PitchItem> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid pitch");
  await requirePermission(db, input.actorId, input.organizationId, "content:write");
  const { normalizedUrl, domain, inferredBrandName } = validateProspectUrl(parsed.data.websiteUrl);
  const brandName = parsed.data.brandName || inferredBrandName;
  const prompts = uniq(parsed.data.prompts);
  const competitors = uniq(parsed.data.competitors).filter((c) => c.toLowerCase() !== brandName.toLowerCase());
  if (!input.collectors.length) throw new DomainError("Pitches are measured from real AI answers. Add an AI provider key (OpenAI, Anthropic, Perplexity, Gemini, xAI or DeepSeek) first.");
  const quota = await usage(db, input.organizationId);
  if (quota.remaining <= 0) throw new DomainError(`Monthly pitch limit reached (${quota.usedThisMonth}/${quota.monthlyLimit} on the ${quota.plan} plan).`);

  const cost = prompts.length * input.collectors.length;
  const reason = `Pitch audit for ${domain}`;
  if (!(await reserveCredits(db, { organizationId: input.organizationId, amount: cost, reason }))) {
    throw new DomainError(`This pitch needs ${cost} credits (1 per AI answer); your organization has ${await getOrgBalance(db, input.organizationId)}.`);
  }
  const results = await collectAll(prompts, input.collectors, { entities: [brandName, ...competitors], country: parsed.data.country });
  const answers = results.flatMap((r) => (r.ok ? [r.answer] : []));
  const failures = results.flatMap((r) => (r.ok ? [] : [{ prompt: r.prompt, model: r.model }]));
  if (failures.length) await refundCredits(db, { organizationId: input.organizationId, amount: failures.length, reason: `${reason}: ${failures.length} answer(s) could not be collected` });
  if (!answers.length) throw new DomainError("No AI answers could be collected (every provider request failed). Your credits were refunded.");

  const payload = computePitchPayload({ answers, failures, brandName, domain, websiteUrl: normalizedUrl, industry: parsed.data.industry || null, prompts, competitors, collectedAt: input.now ?? new Date() });
  return insertPitch(db, { ...input, kind: parsed.data.kind, websiteUrl: normalizedUrl, brandName, payload, spent: answers.length });
}

async function insertPitch(db: Db, input: { actorId: string; organizationId: string; kind: PitchKind; websiteUrl: string; brandName: string; payload: PitchPayload; spent: number }): Promise<PitchItem> {
  const shareId = `${input.kind === "content" ? "cpitch" : "pitch"}_${randomBytes(16).toString("hex")}`;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"pitch_quota:" + input.organizationId}))`);
      const quota = await usage(tx, input.organizationId);
      if (quota.remaining <= 0) throw new DomainError(`Monthly pitch limit reached (${quota.usedThisMonth}/${quota.monthlyLimit} on the ${quota.plan} plan).`);
      const [row] = await tx.insert(pitches).values({ organizationId: input.organizationId, websiteUrl: input.websiteUrl, brandName: input.brandName, shareId, kind: input.kind, payload: input.payload as unknown as Record<string, unknown> }).returning();
      await logActivity(tx, { organizationId: input.organizationId, userId: input.actorId, entityType: "pitch", entityId: row!.id, change: "created", after: { brandName: input.brandName, websiteUrl: input.websiteUrl, kind: input.kind, answers: input.payload.totals.answers, creditsSpent: input.spent } });
      return toPitchItem(row!);
    });
  } catch (err) {
    // the answers were collected but the pitch could not be saved: give the credits back
    await refundCredits(db, { organizationId: input.organizationId, amount: input.spent, reason: `Pitch for ${input.payload.domain} was not saved` });
    throw err;
  }
}

export async function deletePitch(db: Db, input: { actorId: string; organizationId: string; pitchId: string }): Promise<void> {
  if (!z.string().uuid().safeParse(input.pitchId).success) throw new DomainError("Invalid pitch ID");
  await requirePermission(db, input.actorId, input.organizationId, "content:write");
  const [existing] = await db.select().from(pitches).where(and(eq(pitches.id, input.pitchId), eq(pitches.organizationId, input.organizationId), isNull(pitches.deletedAt)));
  if (!existing) throw new NotFoundError("Pitch not found");
  await db.update(pitches).set({ deletedAt: new Date() }).where(eq(pitches.id, existing.id));
  await logActivity(db, { organizationId: input.organizationId, userId: input.actorId, entityType: "pitch", entityId: existing.id, change: "deleted", before: { brandName: existing.brandName, websiteUrl: existing.websiteUrl } });
}
