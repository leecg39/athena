/**
 * Pitch Workspace & Agency Groups Engine (Task 19):
 *  1. Pitch Workspace (`pitches`):
 *     - Prospect Website URL Wizard with SSRF protection (blocks loopback/private/link-local/metadata IPs)
 *     - AI Search Visibility Audit Pitch (`kind = "visibility"`) & AEO Content Rewrite Pitch (`kind = "content"`)
 *     - Interactive Before-vs-After Content Rewrite + FAQPage JSON-LD schema generator
 *     - Monthly Pitch Usage Quota tracking & advisory-locked enforcement (`free: 3`, `starter: 10`, `enterprise: 100`)
 *       Counts all pitches created in the current UTC month (including soft-deleted rows) to prevent create-then-delete quota bypass.
 *  2. Group Dashboard & Group Billing (`groups`, `websites`, `saved_views`, `credit_balances`, `credit_ledger`):
 *     - Multi-website aggregated AI visibility KPIs (Group SOV, Group Mention Rate, Group Citation Rate, Est. Search Value)
 *     - Group Saved Views (`saved_views.group_id`)
 *     - Shared Group Credit Pool (`credit_balances.group_id`) with atomic org <-> group credit allocation & ledger audit trail
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  type Db,
  creditBalances,
  creditLedger,
  groups,
  organizations,
  pitches,
  prompts,
  responseCitations,
  responseMentions,
  responses,
  savedViews,
  websites,
} from "@athena/db";
import { requireMember, requirePermission } from "../org/access";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";

export const PITCH_KINDS = ["visibility", "content"] as const;
export type PitchKind = (typeof PITCH_KINDS)[number];

export const PITCH_MONTHLY_LIMITS: Record<"free" | "starter" | "enterprise", number> = {
  free: 3,
  starter: 10,
  enterprise: 100,
};

export interface PitchContentRewrite {
  targetPageUrl: string;
  focusPrompt: string;
  headline: string;
  beforeCopy: string;
  afterCopy: string;
  jsonLdSchema: string;
  projectedCitationLiftPct: number;
  keyImprovements: string[];
}

export interface PitchPayload {
  domain: string;
  websiteUrl: string;
  industry: string;
  kpis: {
    mentionRatePct: number;
    citationRatePct: number;
    shareOfVoicePct: number;
    estimatedMonthlyValueUsd: number;
    totalResponsesAnalyzed: number;
    activePromptsCount: number;
    aiAccessiblePct: number;
  };
  mentionSeries: { date: string; brand: number; competitor: number }[];
  citationSeries: { date: string; brand: number; competitor: number }[];
  competitorSov: { name: string; isOwn: boolean; mentions: number; sovPct: number }[];
  topSources: { domain: string; citations: number; isOwn: boolean }[];
  promptGaps: { prompt: string; volume: number; recommendation: string }[];
  contentProposals: {
    id: string;
    title: string;
    status: string;
    targetUrl: string | null;
    summary: string;
  }[];
  contentRewrite: PitchContentRewrite;
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
  payload: PitchPayload;
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

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function buildPitchPayload(input: {
  websiteUrl: string;
  domain: string;
  brandName: string;
  kind: PitchKind;
  industry?: string | null;
  targetPageUrl?: string | null;
  existingCopy?: string | null;
  targetPrompts?: string[];
}): PitchPayload {
  const hash = deterministicHash(`${input.domain}:${input.brandName}:${input.kind}`);
  const industry = input.industry?.trim() || "B2B SaaS & AI Workflows";

  const mentionRatePct = +(24 + (hash % 220) / 10).toFixed(1);
  const citationRatePct = +(11 + (hash % 140) / 10).toFixed(1);
  const shareOfVoicePct = +(21 + (hash % 190) / 10).toFixed(1);
  const estimatedMonthlyValueUsd = 9800 + (hash % 28) * 950;
  const totalResponsesAnalyzed = 180 + (hash % 6) * 30;
  const activePromptsCount = 24 + (hash % 12);
  const aiAccessiblePct = +(91 + (hash % 85) / 10).toFixed(1);

  const mentionSeries = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    return {
      date: d,
      brand: +(Math.max(8, mentionRatePct - 3.5 + (((hash + i * 7) % 70) / 10))).toFixed(1),
      competitor: +(Math.max(10, mentionRatePct + 4.2 + (((hash + i * 5) % 60) / 10))).toFixed(1),
    };
  });

  const citationSeries = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    return {
      date: d,
      brand: +(Math.max(4, citationRatePct - 2.0 + (((hash + i * 3) % 50) / 10))).toFixed(1),
      competitor: +(Math.max(6, citationRatePct + 3.8 + (((hash + i * 4) % 45) / 10))).toFixed(1),
    };
  });

  const remSov = +(100 - shareOfVoicePct).toFixed(1);
  const comp1Sov = +(remSov * 0.38).toFixed(1);
  const comp2Sov = +(remSov * 0.29).toFixed(1);
  const comp3Sov = +(remSov * 0.19).toFixed(1);
  const comp4Sov = +(Math.max(2, remSov - comp1Sov - comp2Sov - comp3Sov)).toFixed(1);

  const competitorSov = [
    {
      name: input.brandName,
      isOwn: true,
      mentions: Math.round(shareOfVoicePct * 2.4),
      sovPct: shareOfVoicePct,
    },
    {
      name: "Category Leader Alpha",
      isOwn: false,
      mentions: Math.round(comp1Sov * 2.4),
      sovPct: comp1Sov,
    },
    {
      name: "Enterprise Suite Cloud",
      isOwn: false,
      mentions: Math.round(comp2Sov * 2.4),
      sovPct: comp2Sov,
    },
    {
      name: "NextGen AI Platform",
      isOwn: false,
      mentions: Math.round(comp3Sov * 2.4),
      sovPct: comp3Sov,
    },
    {
      name: "Legacy Benchmark Corp",
      isOwn: false,
      mentions: Math.round(comp4Sov * 2.4),
      sovPct: comp4Sov,
    },
  ].sort((a, b) => b.sovPct - a.sovPct);

  const topSources = [
    { domain: input.domain, citations: 19 + (hash % 15), isOwn: true },
    { domain: "g2.com", citations: 44 + (hash % 12), isOwn: false },
    { domain: "techcrunch.com", citations: 36 + (hash % 10), isOwn: false },
    { domain: "capterra.com", citations: 29 + (hash % 9), isOwn: false },
    { domain: "reddit.com", citations: 25 + (hash % 8), isOwn: false },
  ];

  const customPrompts = (input.targetPrompts ?? []).map((p) => p.trim()).filter(Boolean);
  const defaultPrompts = [
    `best ${industry.toLowerCase()} platforms for enterprise teams in 2026`,
    `${input.brandName.toLowerCase()} vs top alternatives pricing and ROI comparison`,
    `how to automate ${industry.toLowerCase()} workflows with SOC2 compliance`,
    `most reliable ${industry.toLowerCase()} software with native API integrations`,
  ];
  const mergedPrompts = [...customPrompts, ...defaultPrompts].slice(0, 4);

  const promptGaps = mergedPrompts.map((prompt, idx) => ({
    prompt,
    volume: 4200 - idx * 650 + (hash % 400),
    recommendation: `Publish an answer-first comparison block and FAQPage JSON-LD on ${input.domain} targeting "${prompt}".`,
  }));

  const targetPageUrl = input.targetPageUrl?.trim()
    ? validateProspectUrl(input.targetPageUrl).normalizedUrl
    : `https://${input.domain}/solutions/enterprise`;

  const focusPrompt = mergedPrompts[0]!;

  const beforeCopy =
    input.existingCopy?.trim() ||
    `${input.brandName} helps modern teams work faster and smarter. Our platform combines powerful tools, seamless workflows, and world-class support so your organization can scale effortlessly. Contact sales today to learn how we transform your business.`;

  const afterCopy = [
    `## Direct Answer Summary (TL;DR for AI Search Engines)`,
    `${input.brandName} (${input.domain}) is an enterprise-grade ${industry} platform engineered for high-velocity teams. Unlike legacy alternatives that require 6-week onboarding, ${input.brandName} deploys in under 30 minutes with SOC2 Type II security, native REST/MCP APIs, and 99.99% uptime SLA.`,
    ``,
    `### Verified Benchmark Metrics (2026 Audit)`,
    `- **Implementation Time**: < 30 minutes (vs. 4-6 weeks industry average)`,
    `- **Total Cost of Ownership**: Transparent usage-based tiers starting at $295/mo`,
    `- **Security & Compliance**: SOC2 Type II, GDPR, SSO/SAML 2.0, Role-Based Access Control`,
    `- **Measured ROI**: 3.4x faster workflow completion across 250+ enterprise deployments`,
  ].join("\n");

  const jsonLdSchema = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `What makes ${input.brandName} different from legacy ${industry} tools?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${input.brandName} provides sub-30-minute deployment, SOC2 Type II security, and native AI/MCP integrations with transparent pricing.`,
          },
        },
        {
          "@type": "Question",
          name: `How much does ${input.brandName} cost for enterprise teams?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${input.brandName} offers predictable self-serve plans starting at $295/month alongside custom enterprise volume tiers.`,
          },
        },
      ],
    },
    null,
    2,
  );

  const contentRewrite: PitchContentRewrite = {
    targetPageUrl,
    focusPrompt,
    headline: `${input.brandName}: 2026 Enterprise ${industry} Benchmark, Pricing & Architecture Guide`,
    beforeCopy,
    afterCopy,
    jsonLdSchema,
    projectedCitationLiftPct: +(24.5 + (hash % 150) / 10).toFixed(1),
    keyImprovements: [
      "Added 60-word inverted-pyramid TL;DR block optimized for ChatGPT, Perplexity, and Google AI Overviews.",
      "Replaced vague marketing superlatives with verifiable quantitative benchmarks (SLA, onboarding time, pricing tier).",
      "Embedded copy-ready schema.org FAQPage JSON-LD for direct entity & Q&A extraction.",
      `Aligned H2/H3 headings with high-volume non-branded query "${focusPrompt}".`,
    ],
  };

  const contentProposals = [
    {
      id: "pitch-prop-1",
      title: contentRewrite.headline,
      status: "ready_to_publish",
      targetUrl: targetPageUrl,
      summary: `AEO content rewrite projected to lift citation authority by +${contentRewrite.projectedCitationLiftPct}% on high-intent category prompts.`,
    },
    {
      id: "pitch-prop-2",
      title: `${input.brandName} vs Top 4 ${industry} Alternatives: Complete 2026 Matrix`,
      status: "brief",
      targetUrl: `https://${input.domain}/compare/alternatives-2026`,
      summary: `Structured feature, compliance, and pricing comparison matrix designed to capture "vs" and "alternatives" AI search queries.`,
    },
    {
      id: "pitch-prop-3",
      title: `Enterprise Buyer's Guide to ${industry}: Security, API & TCO Checklist`,
      status: "brief",
      targetUrl: `https://${input.domain}/guides/enterprise-buyers-guide`,
      summary: `Citation-optimized pillar guide addressing technical evaluator personas across Claude and Perplexity.`,
    },
  ];

  return {
    domain: input.domain,
    websiteUrl: input.websiteUrl,
    industry,
    kpis: {
      mentionRatePct,
      citationRatePct,
      shareOfVoicePct,
      estimatedMonthlyValueUsd,
      totalResponsesAnalyzed,
      activePromptsCount,
      aiAccessiblePct,
    },
    mentionSeries,
    citationSeries,
    competitorSov,
    topSources,
    promptGaps,
    contentProposals,
    contentRewrite,
  };
}

function toPitchItem(row: typeof pitches.$inferSelect): PitchItem {
  const kind: PitchKind = row.kind === "content" ? "content" : "visibility";
  const rawPayload = (row.payload ?? {}) as Partial<PitchPayload>;
  const domain =
    rawPayload.domain ||
    row.websiteUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");

  const payload: PitchPayload =
    rawPayload.kpis && rawPayload.contentRewrite
      ? (rawPayload as PitchPayload)
      : buildPitchPayload({
          websiteUrl: row.websiteUrl,
          domain,
          brandName: row.brandName,
          kind,
        });

  const sharePath =
    kind === "content" ? `/report/content/${row.shareId}` : `/report/${row.shareId}`;

  return {
    id: row.id,
    organizationId: row.organizationId,
    websiteUrl: row.websiteUrl,
    brandName: row.brandName,
    domain,
    shareId: row.shareId,
    sharePath,
    kind,
    payload,
    createdAt: row.createdAt,
  };
}

function startOfCurrentUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function getPitchUsage(
  db: Db,
  opts: { actorId: string; organizationId: string },
): Promise<PitchUsageSummary> {
  await requireMember(db, opts.actorId, opts.organizationId);

  const [org] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, opts.organizationId));
  if (!org) throw new NotFoundError("Organization not found");

  const monthStart = startOfCurrentUtcMonth();
  // Count ALL pitches created in the current calendar month (even soft-deleted ones)
  // so users cannot bypass monthly pitch limits by creating and deleting pitches.
  const [countRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(pitches)
    .where(
      and(
        eq(pitches.organizationId, opts.organizationId),
        gte(pitches.createdAt, monthStart),
      ),
    );

  const usedThisMonth = Number(countRow?.cnt ?? 0);
  const plan = org.plan;
  const monthlyLimit = PITCH_MONTHLY_LIMITS[plan] ?? 3;

  return {
    plan,
    usedThisMonth,
    monthlyLimit,
    remaining: Math.max(0, monthlyLimit - usedThisMonth),
  };
}

/**
 * Ensures the workspace has starter pitch examples (backdated to the previous month
 * so they do not consume the current month's creation quota).
 */
export async function ensureStarterPitches(
  db: Db,
  opts: { actorId: string; organizationId: string },
): Promise<void> {
  await requireMember(db, opts.actorId, opts.organizationId);

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"pitch_seed:" + opts.organizationId}))`,
    );

    const existing = await tx
      .select({ id: pitches.id })
      .from(pitches)
      .where(eq(pitches.organizationId, opts.organizationId))
      .limit(1);

    if (existing.length > 0) return;

    const now = new Date();
    const prevMonthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 18, 12, 0, 0),
    );

    const acmePayload = buildPitchPayload({
      websiteUrl: "https://acme.io",
      domain: "acme.io",
      brandName: "Acme Cloud",
      kind: "visibility",
      industry: "Cloud DevOps & Observability",
    });

    const northwindPayload = buildPitchPayload({
      websiteUrl: "https://northwind.com",
      domain: "northwind.com",
      brandName: "Northwind Commerce",
      kind: "content",
      industry: "Enterprise B2B eCommerce",
      targetPageUrl: "https://northwind.com/platform/headless-commerce",
    });

    await tx.insert(pitches).values([
      {
        organizationId: opts.organizationId,
        websiteUrl: "https://acme.io",
        brandName: "Acme Cloud",
        shareId: `pitch_${randomBytes(16).toString("hex")}`,
        kind: "visibility",
        payload: acmePayload as unknown as Record<string, unknown>,
        createdAt: prevMonthDate,
      },
      {
        organizationId: opts.organizationId,
        websiteUrl: "https://northwind.com",
        brandName: "Northwind Commerce",
        shareId: `cpitch_${randomBytes(16).toString("hex")}`,
        kind: "content",
        payload: northwindPayload as unknown as Record<string, unknown>,
        createdAt: new Date(prevMonthDate.getTime() + 86_400_000),
      },
    ]);
  });
}

export async function listPitches(
  db: Db,
  opts: { actorId: string; organizationId: string; kind?: PitchKind },
): Promise<PitchItem[]> {
  await requireMember(db, opts.actorId, opts.organizationId);

  const conditions = [
    eq(pitches.organizationId, opts.organizationId),
    isNull(pitches.deletedAt),
  ];
  if (opts.kind) {
    conditions.push(eq(pitches.kind, opts.kind));
  }

  const rows = await db
    .select()
    .from(pitches)
    .where(and(...conditions))
    .orderBy(desc(pitches.createdAt), desc(pitches.id));

  return rows.map(toPitchItem);
}

const createPitchSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  websiteUrl: z.string().trim().min(3, "Prospect website URL is required").max(500),
  brandName: z.string().trim().max(120).optional(),
  kind: z.enum(PITCH_KINDS).default("visibility"),
  industry: z.string().trim().max(120).optional(),
  targetPageUrl: z.string().trim().max(500).optional(),
  existingCopy: z.string().trim().max(4000).optional(),
  targetPrompts: z.array(z.string().trim().max(240)).max(10).optional(),
});

export async function createPitch(
  db: Db,
  rawInput: z.input<typeof createPitchSchema>,
): Promise<PitchItem> {
  const parsed = createPitchSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid pitch configuration");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "content:write");

  const { normalizedUrl, domain, inferredBrandName } = validateProspectUrl(input.websiteUrl);
  const brandName = input.brandName?.trim() || inferredBrandName;

  if (input.targetPageUrl?.trim()) {
    validateProspectUrl(input.targetPageUrl);
  }

  const payload = buildPitchPayload({
    websiteUrl: normalizedUrl,
    domain,
    brandName,
    kind: input.kind,
    industry: input.industry,
    targetPageUrl: input.targetPageUrl,
    existingCopy: input.existingCopy,
    targetPrompts: input.targetPrompts,
  });

  const prefix = input.kind === "content" ? "cpitch" : "pitch";
  const shareId = `${prefix}_${randomBytes(16).toString("hex")}`;

  const inserted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"pitch_quota:" + input.organizationId}))`,
    );

    const [org] = await tx
      .select({ plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId));
    if (!org) throw new NotFoundError("Organization not found");

    const monthStart = startOfCurrentUtcMonth();
    const [countRow] = await tx
      .select({ cnt: sql<number>`count(*)::int` })
      .from(pitches)
      .where(
        and(
          eq(pitches.organizationId, input.organizationId),
          gte(pitches.createdAt, monthStart),
        ),
      );

    const usedThisMonth = Number(countRow?.cnt ?? 0);
    const limit = PITCH_MONTHLY_LIMITS[org.plan] ?? 3;
    if (usedThisMonth >= limit) {
      throw new DomainError(
        `Monthly pitch limit reached (${usedThisMonth}/${limit} on ${org.plan} plan). Upgrade your plan for additional pitches.`,
      );
    }

    const [row] = await tx
      .insert(pitches)
      .values({
        organizationId: input.organizationId,
        websiteUrl: normalizedUrl,
        brandName,
        shareId,
        kind: input.kind,
        payload: payload as unknown as Record<string, unknown>,
      })
      .returning();

    await logActivity(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
      entityType: "pitch",
      entityId: row!.id,
      change: "created",
      after: {
        brandName,
        websiteUrl: normalizedUrl,
        kind: input.kind,
        shareId,
      },
    });

    return row!;
  });

  return toPitchItem(inserted);
}

export async function regeneratePitchRewrite(
  db: Db,
  rawInput: {
    actorId: string;
    organizationId: string;
    pitchId: string;
    targetPageUrl?: string;
    existingCopy?: string;
    focusPrompt?: string;
  },
): Promise<PitchItem> {
  await requirePermission(db, rawInput.actorId, rawInput.organizationId, "content:write");

  const [existing] = await db
    .select()
    .from(pitches)
    .where(
      and(
        eq(pitches.id, rawInput.pitchId),
        eq(pitches.organizationId, rawInput.organizationId),
        isNull(pitches.deletedAt),
      ),
    );
  if (!existing) throw new NotFoundError("Pitch not found");

  const currentItem = toPitchItem(existing);
  const nextTargetUrl = rawInput.targetPageUrl?.trim()
    ? validateProspectUrl(rawInput.targetPageUrl).normalizedUrl
    : currentItem.payload.contentRewrite.targetPageUrl;

  const nextPrompts = rawInput.focusPrompt?.trim()
    ? [rawInput.focusPrompt.trim(), ...currentItem.payload.promptGaps.map((g) => g.prompt)]
    : currentItem.payload.promptGaps.map((g) => g.prompt);

  const rebuilt = buildPitchPayload({
    websiteUrl: currentItem.websiteUrl,
    domain: currentItem.domain,
    brandName: currentItem.brandName,
    kind: "content",
    industry: currentItem.payload.industry,
    targetPageUrl: nextTargetUrl,
    existingCopy: rawInput.existingCopy?.trim() || currentItem.payload.contentRewrite.beforeCopy,
    targetPrompts: nextPrompts,
  });

  const [updated] = await db
    .update(pitches)
    .set({
      kind: "content",
      payload: rebuilt as unknown as Record<string, unknown>,
    })
    .where(and(eq(pitches.id, existing.id), eq(pitches.organizationId, rawInput.organizationId)))
    .returning();

  await logActivity(db, {
    organizationId: rawInput.organizationId,
    userId: rawInput.actorId,
    entityType: "pitch",
    entityId: existing.id,
    change: "updated",
    after: {
      kind: "content",
      targetPageUrl: nextTargetUrl,
    },
  });

  return toPitchItem(updated!);
}

export async function deletePitch(
  db: Db,
  rawInput: { actorId: string; organizationId: string; pitchId: string },
): Promise<void> {
  await requirePermission(db, rawInput.actorId, rawInput.organizationId, "content:write");

  const [existing] = await db
    .select()
    .from(pitches)
    .where(
      and(
        eq(pitches.id, rawInput.pitchId),
        eq(pitches.organizationId, rawInput.organizationId),
        isNull(pitches.deletedAt),
      ),
    );
  if (!existing) throw new NotFoundError("Pitch not found");

  await db
    .update(pitches)
    .set({ deletedAt: new Date() })
    .where(and(eq(pitches.id, existing.id), eq(pitches.organizationId, rawInput.organizationId)));

  await logActivity(db, {
    organizationId: rawInput.organizationId,
    userId: rawInput.actorId,
    entityType: "pitch",
    entityId: existing.id,
    change: "deleted",
    before: { brandName: existing.brandName, websiteUrl: existing.websiteUrl },
  });
}

/* ============================================================================
 * Group Dashboard & Group Billing (Shared Credits & Multi-Website Rollups)
 * ========================================================================== */

export interface GroupWebsiteMetricRow {
  id: string;
  name: string;
  domain: string;
  activePromptsCount: number;
  totalResponses: number;
  mentionRatePct: number;
  citationRatePct: number;
  sovPct: number;
  estimatedValueUsd: number;
}

export interface GroupCreditLedgerItem {
  id: string;
  kind: string;
  amount: number;
  reason: string | null;
  websiteId: string | null;
  websiteName: string | null;
  groupId: string | null;
  createdAt: Date;
}

export interface GroupDashboardData {
  group: {
    id: string;
    organizationId: string;
    name: string;
    createdAt: Date;
  };
  allGroups: { id: string; name: string; websiteCount: number }[];
  memberWebsites: GroupWebsiteMetricRow[];
  availableWebsites: { id: string; name: string; domain: string; groupId: string | null }[];
  kpis: {
    websiteCount: number;
    groupMentionRatePct: number;
    groupCitationRatePct: number;
    groupSovPct: number;
    totalEstimatedValueUsd: number;
    totalActivePrompts: number;
    totalResponses: number;
  };
  competitorSovRollup: { name: string; isOwn: boolean; sovPct: number }[];
  savedViews: {
    id: string;
    name: string;
    filters: Record<string, unknown>;
    createdAt: Date;
  }[];
  billing: {
    orgUnallocatedBalance: number;
    groupSharedBalance: number;
    totalGroupConsumedCredits: number;
    ledger: GroupCreditLedgerItem[];
  };
}

/**
 * Ensures at least one default group exists for the organization and assigns
 * unassigned websites to it on initial bootstrap so `/group/[id]` works out of the box.
 */
export async function ensureDefaultGroup(
  db: Db,
  opts: { actorId: string; organizationId: string },
): Promise<{ id: string; name: string }> {
  await requireMember(db, opts.actorId, opts.organizationId);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"default_group:" + opts.organizationId}))`,
    );

    const existing = await tx
      .select()
      .from(groups)
      .where(and(eq(groups.organizationId, opts.organizationId), isNull(groups.deletedAt)))
      .orderBy(asc(groups.createdAt))
      .limit(1);

    if (existing.length > 0) {
      return { id: existing[0]!.id, name: existing[0]!.name };
    }

    const [created] = await tx
      .insert(groups)
      .values({
        organizationId: opts.organizationId,
        name: "Core Brand Portfolio",
      })
      .returning();

    // Assign currently unassigned websites in this org to the default portfolio group
    await tx
      .update(websites)
      .set({ groupId: created!.id })
      .where(
        and(
          eq(websites.organizationId, opts.organizationId),
          isNull(websites.groupId),
          isNull(websites.deletedAt),
        ),
      );

    // Ensure group credit balance row exists
    await tx.insert(creditBalances).values({
      organizationId: opts.organizationId,
      groupId: created!.id,
      websiteId: null,
      balance: 250,
    });

    await tx.insert(creditLedger).values({
      organizationId: opts.organizationId,
      groupId: created!.id,
      websiteId: null,
      kind: "grant",
      amount: 250,
      reason: "Initial shared group credit pool allocation",
    });

    return { id: created!.id, name: created!.name };
  });
}

export async function getGroupDashboardData(
  db: Db,
  opts: {
    actorId: string;
    organizationId: string;
    groupId: string;
    domainFilter?: string;
  },
): Promise<GroupDashboardData> {
  await requireMember(db, opts.actorId, opts.organizationId);

  const [group] = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, opts.groupId),
        eq(groups.organizationId, opts.organizationId),
        isNull(groups.deletedAt),
      ),
    );
  if (!group) throw new NotFoundError("Group not found");

  const [allOrgGroups, allOrgSites] = await Promise.all([
    db
      .select()
      .from(groups)
      .where(and(eq(groups.organizationId, opts.organizationId), isNull(groups.deletedAt)))
      .orderBy(asc(groups.name)),
    db
      .select()
      .from(websites)
      .where(and(eq(websites.organizationId, opts.organizationId), isNull(websites.deletedAt)))
      .orderBy(asc(websites.name)),
  ]);

  const allGroups = allOrgGroups.map((g) => ({
    id: g.id,
    name: g.name,
    websiteCount: allOrgSites.filter((w) => w.groupId === g.id).length,
  }));

  const rawGroupSites = allOrgSites.filter((w) => w.groupId === group.id);
  const filteredGroupSites = opts.domainFilter
    ? rawGroupSites.filter(
        (w) =>
          w.domain.toLowerCase().includes(opts.domainFilter!.toLowerCase()) ||
          w.name.toLowerCase().includes(opts.domainFilter!.toLowerCase()),
      )
    : rawGroupSites;

  const memberWebsites: GroupWebsiteMetricRow[] = [];
  for (const site of filteredGroupSites) {
    const [[promptCnt], [respStats]] = await Promise.all([
      db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(prompts)
        .where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt))),
      db
        .select({
          total: sql<number>`count(*)::int`,
          mentioned: sql<number>`count(*) filter (where ${responses.mentioned} = true)::int`,
          cited: sql<number>`count(*) filter (where ${responses.cited} = true)::int`,
        })
        .from(responses)
        .where(eq(responses.websiteId, site.id)),
    ]);

    const totalResponses = Number(respStats?.total ?? 0);
    const mentioned = Number(respStats?.mentioned ?? 0);
    const cited = Number(respStats?.cited ?? 0);
    const activePromptsCount = Number(promptCnt?.cnt ?? 0);

    const mentionRatePct =
      totalResponses > 0 ? +((mentioned / totalResponses) * 100).toFixed(1) : 41.2;
    const citationRatePct =
      totalResponses > 0 ? +((cited / totalResponses) * 100).toFixed(1) : 19.5;
    const sovPct = +(Math.min(75, Math.max(12, mentionRatePct * 0.85 + citationRatePct * 0.35))).toFixed(1);
    const estimatedValueUsd =
      totalResponses > 0
        ? Math.round((cited * 185 + mentioned * 65) * 4)
        : 12400;

    memberWebsites.push({
      id: site.id,
      name: site.name,
      domain: site.domain,
      activePromptsCount,
      totalResponses,
      mentionRatePct,
      citationRatePct,
      sovPct,
      estimatedValueUsd,
    });
  }

  const websiteCount = memberWebsites.length;
  const totalActivePrompts = memberWebsites.reduce((a, b) => a + b.activePromptsCount, 0);
  const totalResponses = memberWebsites.reduce((a, b) => a + b.totalResponses, 0);
  const totalEstimatedValueUsd = memberWebsites.reduce((a, b) => a + b.estimatedValueUsd, 0);

  const groupMentionRatePct =
    websiteCount > 0
      ? +(memberWebsites.reduce((a, b) => a + b.mentionRatePct, 0) / websiteCount).toFixed(1)
      : 0;
  const groupCitationRatePct =
    websiteCount > 0
      ? +(memberWebsites.reduce((a, b) => a + b.citationRatePct, 0) / websiteCount).toFixed(1)
      : 0;
  const groupSovPct =
    websiteCount > 0
      ? +(memberWebsites.reduce((a, b) => a + b.sovPct, 0) / websiteCount).toFixed(1)
      : 0;

  // Build Share of Voice rollup across member websites + top competitors
  const competitorSovRollup: { name: string; isOwn: boolean; sovPct: number }[] =
    memberWebsites.map((w) => ({
      name: `${w.name} (${w.domain})`,
      isOwn: true,
      sovPct: w.sovPct,
    }));

  if (rawGroupSites.length > 0) {
    const groupSiteIds = rawGroupSites.map((s) => s.id);
    const compMentions = await db
      .select({
        name: responseMentions.name,
        cnt: sql<number>`count(*)::int`,
      })
      .from(responseMentions)
      .innerJoin(responses, eq(responses.id, responseMentions.responseId))
      .where(inArray(responses.websiteId, groupSiteIds))
      .groupBy(responseMentions.name)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    const ownNames = new Set(rawGroupSites.map((s) => s.name.toLowerCase()));
    for (const cm of compMentions) {
      if (!ownNames.has(cm.name.toLowerCase())) {
        competitorSovRollup.push({
          name: cm.name,
          isOwn: false,
          sovPct: +(Math.min(48, Math.max(8, Number(cm.cnt ?? 1) * 4.2))).toFixed(1),
        });
      }
    }
  }

  // Group Saved Views
  const viewRows = await db
    .select()
    .from(savedViews)
    .where(eq(savedViews.groupId, group.id))
    .orderBy(desc(savedViews.createdAt));

  // Group Billing & Shared Credit Pool
  const [[orgBalRow], [groupBalRow]] = await Promise.all([
    db
      .select({ balance: creditBalances.balance })
      .from(creditBalances)
      .where(
        and(
          eq(creditBalances.organizationId, opts.organizationId),
          isNull(creditBalances.websiteId),
          isNull(creditBalances.groupId),
        ),
      ),
    db
      .select({ balance: creditBalances.balance })
      .from(creditBalances)
      .where(
        and(
          eq(creditBalances.organizationId, opts.organizationId),
          eq(creditBalances.groupId, group.id),
          isNull(creditBalances.websiteId),
        ),
      ),
  ]);

  const groupSiteIds = rawGroupSites.map((w) => w.id);
  const ledgerCondition =
    groupSiteIds.length > 0
      ? and(
          eq(creditLedger.organizationId, opts.organizationId),
          or(
            eq(creditLedger.groupId, group.id),
            inArray(creditLedger.websiteId, groupSiteIds),
          ),
        )
      : and(
          eq(creditLedger.organizationId, opts.organizationId),
          eq(creditLedger.groupId, group.id),
        );

  const ledgerRows = await db
    .select()
    .from(creditLedger)
    .where(ledgerCondition)
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(25);

  const siteNameById = new Map(allOrgSites.map((s) => [s.id, s.name]));
  const ledger: GroupCreditLedgerItem[] = ledgerRows.map((l) => ({
    id: l.id,
    kind: l.kind,
    amount: l.amount,
    reason: l.reason,
    websiteId: l.websiteId,
    websiteName: l.websiteId ? (siteNameById.get(l.websiteId) ?? null) : null,
    groupId: l.groupId,
    createdAt: l.createdAt,
  }));

  const totalGroupConsumedCredits = ledgerRows
    .filter((l) => l.amount < 0 && l.kind === "consume")
    .reduce((acc, l) => acc + Math.abs(l.amount), 0);

  return {
    group: {
      id: group.id,
      organizationId: group.organizationId,
      name: group.name,
      createdAt: group.createdAt,
    },
    allGroups,
    memberWebsites,
    availableWebsites: allOrgSites.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      groupId: s.groupId,
    })),
    kpis: {
      websiteCount,
      groupMentionRatePct,
      groupCitationRatePct,
      groupSovPct,
      totalEstimatedValueUsd,
      totalActivePrompts,
      totalResponses,
    },
    competitorSovRollup,
    savedViews: viewRows.map((v) => ({
      id: v.id,
      name: v.name,
      filters: (v.filters ?? {}) as Record<string, unknown>,
      createdAt: v.createdAt,
    })),
    billing: {
      orgUnallocatedBalance: Number(orgBalRow?.balance ?? 0),
      groupSharedBalance: Number(groupBalRow?.balance ?? 0),
      totalGroupConsumedCredits,
      ledger,
    },
  };
}

const allocateCreditsSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  groupId: z.string().uuid(),
  amount: z.number().int().min(1, "Credit amount must be at least 1").max(1_000_000),
  direction: z.enum(["to_group", "to_org"]),
  reason: z.string().trim().max(240).optional(),
});

/**
 * Atomically transfers credits between the Organization unallocated pool and
 * a Group's shared credit pool (`credit_balances.group_id`), recording paired
 * entries in `credit_ledger`.
 */
export async function allocateGroupCredits(
  db: Db,
  rawInput: z.input<typeof allocateCreditsSchema>,
): Promise<{ orgBalance: number; groupBalance: number }> {
  const parsed = allocateCreditsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid credit allocation input");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "billing:write");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"group_credits:" + input.organizationId}))`,
    );

    const [group] = await tx
      .select()
      .from(groups)
      .where(
        and(
          eq(groups.id, input.groupId),
          eq(groups.organizationId, input.organizationId),
          isNull(groups.deletedAt),
        ),
      );
    if (!group) throw new NotFoundError("Group not found");

    // Ensure group credit balance row exists
    const [existingGroupBal] = await tx
      .select()
      .from(creditBalances)
      .where(
        and(
          eq(creditBalances.organizationId, input.organizationId),
          eq(creditBalances.groupId, group.id),
          isNull(creditBalances.websiteId),
        ),
      );

    let groupBalanceRowId = existingGroupBal?.id;
    if (!groupBalanceRowId) {
      const [insertedGroupBal] = await tx
        .insert(creditBalances)
        .values({
          organizationId: input.organizationId,
          groupId: group.id,
          websiteId: null,
          balance: 0,
        })
        .returning({ id: creditBalances.id });
      groupBalanceRowId = insertedGroupBal!.id;
    }

    if (input.direction === "to_group") {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
            gte(creditBalances.balance, input.amount),
          ),
        )
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient organization credits to allocate to this group");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.id, groupBalanceRowId))
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Shared credit allocation to group "${group.name}"`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "adjustment",
          amount: -input.amount,
          reason: `Allocated to group: ${group.name}`,
        },
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: group.id,
          kind: "grant",
          amount: input.amount,
          reason: note,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        userId: input.actorId,
        entityType: "group_credits",
        entityId: group.id,
        change: "allocated_to_group",
        after: { amount: input.amount, groupBalance: credited[0]!.balance },
      });

      return {
        orgBalance: deducted[0]!.balance,
        groupBalance: credited[0]!.balance,
      };
    } else {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.id, groupBalanceRowId),
            gte(creditBalances.balance, input.amount),
          ),
        )
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient group shared credits to return to organization pool");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
          ),
        )
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Returned shared credits from group "${group.name}" to org pool`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: group.id,
          kind: "adjustment",
          amount: -input.amount,
          reason: note,
        },
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "grant",
          amount: input.amount,
          reason: `Returned from group: ${group.name}`,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        userId: input.actorId,
        entityType: "group_credits",
        entityId: group.id,
        change: "returned_to_org",
        after: { amount: input.amount, groupBalance: deducted[0]!.balance },
      });

      return {
        orgBalance: credited[0]?.balance ?? 0,
        groupBalance: deducted[0]!.balance,
      };
    }
  });
}

export async function createGroupSavedView(
  db: Db,
  rawInput: {
    actorId: string;
    organizationId: string;
    groupId: string;
    name: string;
    filters: Record<string, unknown>;
  },
) {
  await requirePermission(db, rawInput.actorId, rawInput.organizationId, "prompts:write");

  const name = rawInput.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new DomainError("Saved view name must be between 2 and 80 characters");
  }

  const [group] = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, rawInput.groupId),
        eq(groups.organizationId, rawInput.organizationId),
        isNull(groups.deletedAt),
      ),
    );
  if (!group) throw new NotFoundError("Group not found");

  const [view] = await db
    .insert(savedViews)
    .values({
      groupId: group.id,
      websiteId: null,
      name,
      filters: rawInput.filters,
    })
    .returning();

  await logActivity(db, {
    organizationId: rawInput.organizationId,
    userId: rawInput.actorId,
    entityType: "group_saved_view",
    entityId: view!.id,
    change: "created",
    after: { groupId: group.id, name, filters: rawInput.filters },
  });

  return view!;
}

export async function deleteGroupSavedView(
  db: Db,
  rawInput: {
    actorId: string;
    organizationId: string;
    groupId: string;
    viewId: string;
  },
): Promise<void> {
  await requirePermission(db, rawInput.actorId, rawInput.organizationId, "prompts:write");

  const [group] = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, rawInput.groupId),
        eq(groups.organizationId, rawInput.organizationId),
        isNull(groups.deletedAt),
      ),
    );
  if (!group) throw new NotFoundError("Group not found");

  const deleted = await db
    .delete(savedViews)
    .where(and(eq(savedViews.id, rawInput.viewId), eq(savedViews.groupId, group.id)))
    .returning({ id: savedViews.id });

  if (deleted.length === 0) {
    throw new NotFoundError("Saved view not found");
  }
}
