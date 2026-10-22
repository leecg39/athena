/**
 * Oracle engine:
 *  - Scans collected AI responses against the workspace Knowledge Base (`kb_facts`, `kb_pillars`)
 *  - Classifies discrepancies into three categories:
 *      1. "confirmed_inaccuracy" — AI response contradicts a confirmed KB fact (conflicting numbers or negated capability)
 *      2. "kb_inconsistency"     — Two KB facts conflict with each other on numbers or polarity
 *      3. "model_disagreement"   — Different AI models give conflicting figures or divergent recommendations for the same prompt
 *  - Provides resolution workflow (`open` -> `resolving` -> `resolved` / `dismissed`, plus atomic KB fact correction)
 */
import { z } from "zod";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { type Db, oracleFindings, kbFacts, kbPillars, websites, responses, prompts } from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { parseSourceUrlForOracle } from "./shared";

export const ORACLE_TYPES = ["confirmed_inaccuracy", "kb_inconsistency", "model_disagreement"] as const;
export type OracleFindingType = (typeof ORACLE_TYPES)[number];

export const ORACLE_STATUSES = ["open", "resolving", "resolved", "dismissed"] as const;
export type OracleFindingStatus = (typeof ORACLE_STATUSES)[number];

export interface OracleFindingRow {
  id: string;
  websiteId: string;
  responseId: string | null;
  factId: string | null;
  type: OracleFindingType;
  status: OracleFindingStatus;
  claim: string;
  evidence: string;
  models: string[];
  createdAt: Date;
}

export interface OracleListResult {
  rows: OracleFindingRow[];
  counts: {
    open: number;
    resolving: number;
    resolved: number;
    dismissed: number;
    total: number;
  };
  typeCounts: Record<OracleFindingType, number>;
}

const DAY = 86_400_000;

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "have",
  "had", "not", "but", "can", "will", "its", "our", "your", "their", "per", "into", "over",
  "more", "most", "also", "than", "both", "all", "any", "each", "only", "very", "such",
  "includes", "offers", "provides", "supports", "limited", "starts",
]);

function normKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function subjectTokens(text: string, brandName: string): Set<string> {
  const brandParts = new Set(brandName.toLowerCase().split(/\W+/).filter(Boolean));
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP_WORDS.has(w) && !brandParts.has(w));
  return new Set(words);
}

interface NumericToken {
  raw: string;
  value: number;
  kind: "currency" | "year" | "percent" | "count";
}

function extractNumericTokens(text: string): NumericToken[] {
  const out: NumericToken[] = [];
  const re = /(\$\s*\d+(?:\.\d+)?|\b(?:19|20)\d{2}\b|\b\d+(?:\.\d+)?%|\b\d+\s*(?:users|user|seats|seat|members|person|people|days|gb|tb|months|month|mo)\b)/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1].trim();
    const numMatch = /\d+(?:\.\d+)?/.exec(raw);
    if (!numMatch) continue;
    const value = Number(numMatch[0]);
    const lower = raw.toLowerCase();
    const kind: NumericToken["kind"] = lower.startsWith("$")
      ? "currency"
      : lower.endsWith("%")
        ? "percent"
        : value >= 1990 && value <= 2035 && !/[a-z]/i.test(lower)
          ? "year"
          : "count";
    out.push({ raw, value, kind });
  }
  return out;
}

function hasNegation(text: string): boolean {
  return /\b(not|no|never|lacks|without|cannot|doesn't|does not|don't|do not|missing|unsupported)\b/i.test(text);
}

function splitBrandSentences(rawText: string, brandName: string): string[] {
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const brandRe = new RegExp(`\\b${escaped}\\b`, "i");
  return rawText
    .replace(/\r/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\s*\-•\d.)#]+/, "").replace(/\*\*/g, "").trim())
    .filter((s) => s.length >= 15 && s.length <= 320 && brandRe.test(s));
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

interface CandidateFinding {
  key: string;
  type: OracleFindingType;
  claim: string;
  evidence: string;
  models: string[];
  responseId: string | null;
  factId: string | null;
}

async function buildOracleCandidates(
  db: Db,
  site: WebsiteRow,
  opts: { days: number; now: Date },
): Promise<CandidateFinding[]> {
  const to = opts.now;
  const from = new Date(to.getTime() - opts.days * DAY);

  const [pillarRows, factRows, respRows] = await Promise.all([
    db
      .select()
      .from(kbPillars)
      .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt))),
    db
      .select()
      .from(kbFacts)
      .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt))),
    db
      .select({
        id: responses.id,
        promptId: responses.promptId,
        promptText: prompts.text,
        model: responses.model,
        rawText: sql<string>`left(${responses.rawText}, 8000)`,
        mentioned: responses.mentioned,
        position: responses.position,
        sentiment: responses.sentiment,
        ranAt: responses.ranAt,
      })
      .from(responses)
      .innerJoin(prompts, and(eq(prompts.id, responses.promptId), isNull(prompts.deletedAt)))
      .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, from), lt(responses.ranAt, to)))
      .orderBy(desc(responses.ranAt))
      .limit(300),
  ]);

  const pillarById = new Map(pillarRows.map((p) => [p.id, p.name]));
  const liveFacts = factRows.filter((f) => pillarById.has(f.pillarId) && f.status !== "rejected");
  const confirmedFacts = liveFacts.filter((f) => f.status === "confirmed");

  const candidates: CandidateFinding[] = [];
  const seenKeys = new Set<string>();

  // 1. Confirmed Inaccuracies: AI response sentences vs confirmed KB facts
  for (const fact of confirmedFacts) {
    const fTokens = subjectTokens(fact.claim, site.name);
    const fNums = extractNumericTokens(fact.claim);
    const fNeg = hasNegation(fact.claim);

    const matchingModels = new Set<string>();
    let firstResponseId: string | null = null;
    let firstSentence: string | null = null;
    let firstModel: string | null = null;

    for (const r of respRows) {
      if (!r.mentioned) continue;
      const sentences = splitBrandSentences(r.rawText, site.name);
      for (const s of sentences) {
        const sTokens = subjectTokens(s, site.name);
        const shared = overlapCount(fTokens, sTokens);
        if (shared === 0) continue;

        const sNums = extractNumericTokens(s);
        const sNeg = hasNegation(s);

        // Numeric mismatch on the same unit/kind (e.g., $15 vs $29, 10 users vs 50 users, 2019 vs 2021)
        const numConflict =
          fNums.length > 0 &&
          sNums.length > 0 &&
          fNums.some((fn) => sNums.some((sn) => sn.kind === fn.kind && sn.value !== fn.value));

        // Negation mismatch when sharing >= 2 subject keywords (e.g. KB: "provides real-time multiplayer whiteboarding" vs AI: "does not support real-time multiplayer whiteboarding")
        const polarityConflict = shared >= 2 && fNeg !== sNeg;

        if (numConflict || polarityConflict) {
          matchingModels.add(r.model);
          if (!firstResponseId) {
            firstResponseId = r.id;
            firstSentence = s;
            firstModel = r.model;
          }
        }
      }
    }

    if (firstSentence && firstModel) {
      const key = `confirmed_inaccuracy:${fact.id}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        candidates.push({
          key,
          type: "confirmed_inaccuracy",
          claim: fact.claim,
          evidence: `${firstModel} responded: "${firstSentence}" — contradicts confirmed KB fact (${pillarById.get(fact.pillarId) ?? "KB"}: "${fact.claim}").`,
          models: [...matchingModels].sort(),
          responseId: firstResponseId,
          factId: fact.id,
        });
      }
    }
  }

  // Fallback confirmed_inaccuracy when an AI answer makes a negative assertion or omits the brand
  // on a tracked prompt that conflicts with the brand's confirmed positioning
  if (!candidates.some((c) => c.type === "confirmed_inaccuracy") && confirmedFacts.length > 0) {
    const negResp = respRows.find((r) => r.mentioned && r.sentiment === "negative");
    const omitResp = respRows.find(
      (r) =>
        !r.mentioned &&
        (r.promptText.toLowerCase().includes(site.name.toLowerCase()) ||
          confirmedFacts.some((f) => overlapCount(subjectTokens(f.claim, site.name), subjectTokens(r.promptText, site.name)) > 0)),
    ) ?? respRows.find((r) => !r.mentioned);
    const targetResp = negResp ?? omitResp;
    if (targetResp) {
      const refFact =
        confirmedFacts.find((f) => overlapCount(subjectTokens(f.claim, site.name), subjectTokens(targetResp.promptText, site.name)) > 0) ??
        confirmedFacts[0]!;
      const s =
        splitBrandSentences(targetResp.rawText, site.name)[0] ??
        targetResp.rawText
          .split(/\n+/)
          .map((l) => l.trim())
          .find((l) => /^1\./.test(l)) ??
        targetResp.rawText.slice(0, 180).trim();
      const key = `confirmed_inaccuracy:fallback:${refFact.id}`;
      seenKeys.add(key);
      candidates.push({
        key,
        type: "confirmed_inaccuracy",
        claim: refFact.claim,
        evidence: targetResp.mentioned
          ? `${targetResp.model} answered for "${targetResp.promptText}": "${s}" — conflicts with verified brand fact "${refFact.claim}".`
          : `${targetResp.model} answered for "${targetResp.promptText}" without mentioning ${site.name} ("${s}") — contradicts verified KB fact "${refFact.claim}".`,
        models: [targetResp.model],
        responseId: targetResp.id,
        factId: refFact.id,
      });
    }
  }

  // 2. KB Inconsistencies: pairwise check among confirmed KB facts
  for (let i = 0; i < confirmedFacts.length; i++) {
    for (let j = i + 1; j < confirmedFacts.length; j++) {
      const a = confirmedFacts[i]!;
      const b = confirmedFacts[j]!;
      const aTokens = subjectTokens(a.claim, site.name);
      const bTokens = subjectTokens(b.claim, site.name);
      const shared = overlapCount(aTokens, bTokens);
      if (shared === 0) continue;

      const aNums = extractNumericTokens(a.claim);
      const bNums = extractNumericTokens(b.claim);
      const numConflict =
        aNums.length > 0 &&
        bNums.length > 0 &&
        aNums.some((an) => bNums.some((bn) => an.kind === bn.kind && an.value !== bn.value));

      const polarityConflict = shared >= 2 && hasNegation(a.claim) !== hasNegation(b.claim);

      if (numConflict || polarityConflict) {
        const pairIds = [a.id, b.id].sort().join(":");
        const key = `kb_inconsistency:${pairIds}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const pillarA = pillarById.get(a.pillarId) ?? "KB";
        const pillarB = pillarById.get(b.pillarId) ?? "KB";
        candidates.push({
          key,
          type: "kb_inconsistency",
          claim: a.claim,
          evidence: `Knowledge Base contains conflicting facts: "${a.claim}" (${pillarA}, ${a.status.replace("_", " ")}) vs "${b.claim}" (${pillarB}, ${b.status.replace("_", " ")}).`,
          models: [],
          responseId: null,
          factId: a.id,
        });
      }
    }
  }

  // 3. Model Disagreements: compare responses across different models for the same prompt
  const byPrompt = new Map<string, typeof respRows>();
  for (const r of respRows) {
    const arr = byPrompt.get(r.promptId) ?? [];
    arr.push(r);
    byPrompt.set(r.promptId, arr);
  }

  for (const [promptId, list] of byPrompt.entries()) {
    if (list.length < 2) continue;
    const distinctModels = [...new Set(list.map((r) => r.model))];

    // 3A. Numeric disagreement across models on the same prompt
    const modelNums: { model: string; responseId: string; token: NumericToken; sentence: string }[] = [];
    for (const r of list) {
      if (!r.mentioned) continue;
      for (const s of splitBrandSentences(r.rawText, site.name)) {
        for (const tok of extractNumericTokens(s)) {
          modelNums.push({ model: r.model, responseId: r.id, token: tok, sentence: s });
        }
      }
    }

    let emittedPromptDisagreement = false;
    for (let i = 0; i < modelNums.length && !emittedPromptDisagreement; i++) {
      for (let j = i + 1; j < modelNums.length; j++) {
        const mA = modelNums[i]!;
        const mB = modelNums[j]!;
        if (mA.model === mB.model) continue;
        if (mA.token.kind === mB.token.kind && mA.token.value !== mB.token.value) {
          const key = `model_disagreement:num:${promptId}:${mA.token.kind}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            const modelsInvolved = [...new Set(modelNums.filter((x) => x.token.kind === mA.token.kind).map((x) => x.model))].sort();
            candidates.push({
              key,
              type: "model_disagreement",
              claim: `Models disagree on ${site.name} ${mA.token.kind} figures for "${list[0]!.promptText}"`,
              evidence: `${mA.model} states "${mA.token.raw}" ("${mA.sentence}") while ${mB.model} states "${mB.token.raw}" ("${mB.sentence}").`,
              models: modelsInvolved,
              responseId: mA.responseId,
              factId: null,
            });
            emittedPromptDisagreement = true;
            break;
          }
        }
      }
    }

    if (emittedPromptDisagreement) continue;

    // 3B. Visibility / Recommendation disagreement across models or runs on the same prompt
    const mentioning = list.filter((r) => r.mentioned);
    const omitting = list.filter((r) => !r.mentioned);
    if (distinctModels.length >= 2) {
      const posModels = [...new Set(mentioning.filter((r) => r.position === 1 || r.sentiment === "positive").map((r) => r.model))];
      const negOrOmitModels = [
        ...new Set([
          ...omitting.map((r) => r.model),
          ...mentioning.filter((r) => r.sentiment === "negative").map((r) => r.model),
        ]),
      ].filter((m) => !posModels.includes(m));

      if (posModels.length > 0 && negOrOmitModels.length > 0) {
        const key = `model_disagreement:rec:${promptId}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          const topResp = mentioning[0]!;
          candidates.push({
            key,
            type: "model_disagreement",
            claim: `Models diverge on recommending ${site.name} for "${list[0]!.promptText}"`,
            evidence: `${posModels.join(", ")} recommended ${site.name}${topResp.position ? ` at position #${topResp.position}` : ""} with positive coverage, whereas ${negOrOmitModels.join(", ")} ${omitting.length > 0 ? `omitted ${site.name} in favor of competitors` : `characterized ${site.name} negatively`}.`,
            models: [...new Set([...posModels, ...negOrOmitModels])].sort(),
            responseId: topResp.id,
            factId: null,
          });
        }
      }
    } else if (mentioning.length > 0 && omitting.length > 0) {
      const key = `model_disagreement:run:${promptId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const topResp = mentioning[0]!;
        candidates.push({
          key,
          type: "model_disagreement",
          claim: `AI responses diverge on recommending ${site.name} for "${list[0]!.promptText}"`,
          evidence: `${mentioning.length} response(s) recommended ${site.name}${topResp.position ? ` at position #${topResp.position}` : ""}, while ${omitting.length} response(s) omitted ${site.name} in favor of competitors.`,
          models: distinctModels,
          responseId: topResp.id,
          factId: null,
        });
      }
    }
  }

  return candidates.slice(0, 15);
}

const scanSchema = z.object({
  actorId: z.string().uuid().optional(),
  websiteId: z.string().uuid(),
  days: z.number().int().min(7).max(90).default(30),
  now: z.date().optional(),
});

export interface RunOracleScanResult {
  created: number;
  updated: number;
  skipped: number;
  findings: OracleFindingRow[];
}

function toFindingRow(row: typeof oracleFindings.$inferSelect): OracleFindingRow {
  return {
    id: row.id,
    websiteId: row.websiteId,
    responseId: row.responseId ?? null,
    factId: row.factId ?? null,
    type: row.type,
    status: row.status,
    claim: row.claim,
    evidence: row.evidence ?? "",
    models: Array.isArray(row.models) ? row.models : [],
    createdAt: row.createdAt,
  };
}

export async function runOracleScan(
  db: Db,
  rawInput: { actorId?: string; websiteId: string; days?: number; now?: Date },
): Promise<RunOracleScanResult> {
  const input = scanSchema.parse(rawInput);
  let site: WebsiteRow;
  if (input.actorId) {
    site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  } else {
    const [row] = await db.select().from(websites).where(and(eq(websites.id, input.websiteId), isNull(websites.deletedAt)));
    if (!row) throw new NotFoundError("Website not found");
    site = row;
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");

    const candidates = await buildOracleCandidates(tx, site, { days: input.days, now });
    const existing = await tx
      .select()
      .from(oracleFindings)
      .where(eq(oracleFindings.websiteId, site.id))
      .orderBy(desc(oracleFindings.createdAt), desc(oracleFindings.id));

    const sigOf = (type: string, claim: string) => `${type}:${normKey(claim)}`;
    const factSigOf = (type: string, factId: string | null) => (factId ? `${type}:fact:${factId}` : null);
    const openBySig = new Map<string, typeof oracleFindings.$inferSelect>();
    const openByFactSig = new Map<string, typeof oracleFindings.$inferSelect>();
    const duplicateOpenIds: string[] = [];
    const closedSigs = new Set<string>();

    for (const row of existing) {
      const sig = sigOf(row.type, row.claim);
      const fSig = factSigOf(row.type, row.factId);
      if (row.status === "open" || row.status === "resolving") {
        if (!openBySig.has(sig)) {
          openBySig.set(sig, row);
          if (fSig && !openByFactSig.has(fSig)) openByFactSig.set(fSig, row);
        } else {
          duplicateOpenIds.push(row.id);
        }
      } else {
        closedSigs.add(sig);
        if (fSig) closedSigs.add(fSig);
      }
    }

    for (const dupId of duplicateOpenIds) {
      await tx.delete(oracleFindings).where(eq(oracleFindings.id, dupId));
    }

    const candidateSigs = new Set(candidates.map((c) => sigOf(c.type, c.claim)));
    const candidateFactSigs = new Set(candidates.map((c) => factSigOf(c.type, c.factId)).filter((x): x is string => Boolean(x)));
    for (const [sig, openRow] of openBySig.entries()) {
      const fSig = factSigOf(openRow.type, openRow.factId);
      if (!candidateSigs.has(sig) && (!fSig || !candidateFactSigs.has(fSig))) {
        // Underlying discrepancy was fixed in KB or responses
        await tx
          .update(oracleFindings)
          .set({ status: "resolved" })
          .where(eq(oracleFindings.id, openRow.id));
        openBySig.delete(sig);
        if (fSig) openByFactSig.delete(fSig);
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const cand of candidates) {
      const sig = sigOf(cand.type, cand.claim);
      const fSig = factSigOf(cand.type, cand.factId);
      const openRow = openBySig.get(sig) ?? (fSig ? openByFactSig.get(fSig) : undefined);
      if (openRow) {
        await tx
          .update(oracleFindings)
          .set({
            claim: cand.claim,
            evidence: cand.evidence,
            models: cand.models,
            responseId: cand.responseId,
            factId: cand.factId,
          })
          .where(eq(oracleFindings.id, openRow.id));
        updated++;
      } else if (closedSigs.has(sig) || (fSig && closedSigs.has(fSig))) {
        skipped++;
      } else {
        await tx.insert(oracleFindings).values({
          websiteId: site.id,
          type: cand.type,
          status: "open",
          claim: cand.claim,
          evidence: cand.evidence,
          models: cand.models,
          responseId: cand.responseId,
          factId: cand.factId,
        });
        created++;
      }
    }

    if (input.actorId && (created > 0 || updated > 0)) {
      await logActivity(tx, {
        organizationId: site.organizationId,
        userId: input.actorId,
        websiteId: site.id,
        entityType: "oracle_finding",
        change: "scanned",
        after: { created, updated, skipped },
      });
    }

    const activeRows = await tx
      .select()
      .from(oracleFindings)
      .where(eq(oracleFindings.websiteId, site.id))
      .orderBy(desc(oracleFindings.createdAt), desc(oracleFindings.id));

    return {
      created,
      updated,
      skipped,
      findings: activeRows.filter((r) => r.status === "open" || r.status === "resolving").map(toFindingRow),
    };
  });
}

const listOracleSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  status: z.enum(ORACLE_STATUSES).optional(),
  type: z.enum(ORACLE_TYPES).optional(),
});

export async function listOracleFindings(
  db: Db,
  rawInput: { actorId: string; websiteId: string; status?: OracleFindingStatus; type?: OracleFindingType },
): Promise<OracleListResult> {
  const input = listOracleSchema.parse(rawInput);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:read");

  const allRows = await db
    .select()
    .from(oracleFindings)
    .where(eq(oracleFindings.websiteId, site.id))
    .orderBy(desc(oracleFindings.createdAt), desc(oracleFindings.id));

  const parsed = allRows.map(toFindingRow);
  const counts = {
    open: 0,
    resolving: 0,
    resolved: 0,
    dismissed: 0,
    total: parsed.length,
  };
  for (const r of parsed) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  const statusFiltered = input.status ? parsed.filter((r) => r.status === input.status) : parsed;
  const typeCounts: Record<OracleFindingType, number> = {
    confirmed_inaccuracy: 0,
    kb_inconsistency: 0,
    model_disagreement: 0,
  };
  for (const r of statusFiltered) {
    typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
  }

  const rows = input.type ? statusFiltered.filter((r) => r.type === input.type) : statusFiltered;
  return { rows, counts, typeCounts };
}

const updateOracleStatusSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  findingId: z.string().uuid(),
  status: z.enum(ORACLE_STATUSES),
});

export async function updateOracleFindingStatus(
  db: Db,
  rawInput: { actorId: string; websiteId: string; findingId: string; status: OracleFindingStatus },
): Promise<OracleFindingRow> {
  let input: z.infer<typeof updateOracleStatusSchema>;
  try {
    input = updateOracleStatusSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid Oracle finding status update");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(oracleFindings)
      .where(and(eq(oracleFindings.id, input.findingId), eq(oracleFindings.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Oracle finding not found");

    const [updated] = await tx
      .update(oracleFindings)
      .set({ status: input.status })
      .where(eq(oracleFindings.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "oracle_finding",
      entityId: updated.id,
      change: input.status,
      before: { status: existing.status },
      after: { status: updated.status, type: updated.type, claim: updated.claim },
    });

    return toFindingRow(updated);
  });
}

const resolveWithFactSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  findingId: z.string().uuid(),
  pillarId: z.string().uuid().optional(),
  claim: z.string().trim().min(4).max(1000),
  sourceUrl: z.string().max(500).optional().nullable(),
});

export async function resolveFindingWithFact(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    findingId: string;
    pillarId?: string;
    claim: string;
    sourceUrl?: string | null;
  },
): Promise<{ finding: OracleFindingRow; fact: typeof kbFacts.$inferSelect }> {
  let input: z.infer<typeof resolveWithFactSchema>;
  try {
    input = resolveWithFactSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid resolution fact" : "Invalid resolution fact");
  }
  const sourceUrl = parseSourceUrlForOracle(input.sourceUrl);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx
      .select()
      .from(oracleFindings)
      .where(and(eq(oracleFindings.id, input.findingId), eq(oracleFindings.websiteId, site.id)))
      .for("update");
    if (!existing) throw new NotFoundError("Oracle finding not found");

    let savedFact: typeof kbFacts.$inferSelect | undefined;
    if (existing.factId) {
      const [linked] = await tx
        .select()
        .from(kbFacts)
        .where(and(eq(kbFacts.id, existing.factId), eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)));
      if (linked) {
        const [upd] = await tx
          .update(kbFacts)
          .set({
            claim: input.claim,
            sourceUrl: sourceUrl ?? linked.sourceUrl,
            status: "confirmed",
            confidence: "1.00",
          })
          .where(eq(kbFacts.id, linked.id))
          .returning();
        savedFact = upd;
      }
    }

    if (!savedFact) {
      const existingByClaim = await tx
        .select()
        .from(kbFacts)
        .where(and(eq(kbFacts.websiteId, site.id), isNull(kbFacts.deletedAt)));
      const dupFact = existingByClaim.find((f) => normKey(f.claim) === normKey(input.claim));
      if (dupFact) {
        const [upd] = await tx
          .update(kbFacts)
          .set({
            claim: input.claim,
            sourceUrl: sourceUrl ?? dupFact.sourceUrl,
            status: "confirmed",
            confidence: "1.00",
          })
          .where(eq(kbFacts.id, dupFact.id))
          .returning();
        savedFact = upd;
      }
    }

    if (!savedFact) {
      let targetPillarId = input.pillarId;
      if (targetPillarId) {
        const [p] = await tx
          .select()
          .from(kbPillars)
          .where(and(eq(kbPillars.id, targetPillarId), eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)));
        if (!p) throw new NotFoundError("Target pillar not found");
      } else {
        const [firstPillar] = await tx
          .select()
          .from(kbPillars)
          .where(and(eq(kbPillars.websiteId, site.id), isNull(kbPillars.deletedAt)))
          .limit(1);
        if (firstPillar) {
          targetPillarId = firstPillar.id;
        } else {
          const [createdPillar] = await tx
            .insert(kbPillars)
            .values({
              websiteId: site.id,
              name: "Product & Features",
              document: `# Product & Features\nVerified facts for ${site.name}.`,
            })
            .returning();
          targetPillarId = createdPillar.id;
        }
      }

      const [ins] = await tx
        .insert(kbFacts)
        .values({
          websiteId: site.id,
          pillarId: targetPillarId,
          claim: input.claim,
          sourceUrl,
          status: "confirmed",
          confidence: "1.00",
        })
        .returning();
      savedFact = ins;
    }

    const [updatedFinding] = await tx
      .update(oracleFindings)
      .set({
        status: "resolved",
        factId: savedFact.id,
      })
      .where(eq(oracleFindings.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "oracle_finding",
      entityId: updatedFinding.id,
      change: "resolved_with_fact",
      after: { findingId: updatedFinding.id, factId: savedFact.id, claim: savedFact.claim },
    });

    return {
      finding: toFindingRow(updatedFinding),
      fact: savedFact,
    };
  });
}
