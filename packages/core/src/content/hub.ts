/**
 * Content Hub engine:
 *  - Spreadsheet-style grid CRUD (`content_items` + custom JSONB columns)
 *  - AI Agent pipeline: Brief (`content_briefs`) -> Draft (`content_drafts`) -> Version (`content_versions`)
 *    grounded in workspace Knowledge Base (`kb_facts`), Internal Links (`site_health_pages`), Prompts, and Competitors
 *  - "Revise with Athena": iterative AI revision creating tracked versions (v1 -> v2 -> v3...)
 *  - URL importer (`importContentFromUrl`) to pull existing brand pages into the revision workflow
 */
import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  type Db,
  contentItems,
  contentBriefs,
  contentDrafts,
  contentVersions,
  publishTargets,
  websites,
  prompts,
  kbFacts,
  siteHealthPages,
  competitors,
  insights,
  responses,
  responseCitations,
} from "@athena/db";
import { requireWebsitePermission, type WebsiteRow } from "../tenancy";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import {
  CONTENT_STATUSES,
  type ContentStatus,
  maskConfigSecrets,
  normKey,
  normalizeContentUrl,
  slugify,
} from "./shared";

const MAX_CONTENT_ITEMS = 300;
const DAY = 86_400_000;

export interface ContentBriefRow {
  id: string;
  contentId: string;
  body: string;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface ContentDraftRow {
  id: string;
  contentId: string;
  briefId: string | null;
  body: string;
  createdAt: Date;
}

export interface ContentVersionRow {
  id: string;
  contentId: string;
  draftId: string | null;
  body: string;
  version: number;
  createdAt: Date;
}

export interface ContentHubItem {
  id: string;
  websiteId: string;
  title: string;
  targetUrl: string | null;
  promptId: string | null;
  promptText: string | null;
  status: ContentStatus;
  columns: Record<string, string | number | boolean>;
  agentStage: "idle" | "brief_ready" | "draft_ready" | "revised" | "published";
  citations30d: number;
  latestBrief: ContentBriefRow | null;
  latestDraft: ContentDraftRow | null;
  versions: ContentVersionRow[];
  createdAt: Date;
}

export interface PublishTargetSummary {
  id: string;
  provider: string;
  config: Record<string, string>;
  createdAt: Date;
}

export interface ContentHubSnapshot {
  items: ContentHubItem[];
  counts: {
    idea: number;
    brief: number;
    draft: number;
    review: number;
    approved: number;
    published: number;
    total: number;
  };
  customColumnKeys: string[];
  publishTargets: PublishTargetSummary[];
  prompts: { id: string; text: string }[];
}

const RESERVED_COLUMN_KEYS = new Set([
  "catalogProduct",
  "catalogProductId",
  "agentStage",
  "publishedProvider",
  "publishedUrl",
  "publishedAt",
  "publishedVersion",
  "citationsSeed",
  "titleScore",
  "descScore",
  "faqStatus",
  "faqBody",
]);

function inferAgentStage(
  status: ContentStatus,
  cols: Record<string, string | number | boolean>,
  hasBrief: boolean,
  hasDraft: boolean,
  versionCount: number,
): ContentHubItem["agentStage"] {
  if (status === "published" || cols.agentStage === "published") return "published";
  if (cols.agentStage === "revised" || versionCount > 1 || status === "review" || status === "approved") return "revised";
  if (hasDraft || status === "draft" || cols.agentStage === "draft_ready") return "draft_ready";
  if (hasBrief || status === "brief" || cols.agentStage === "brief_ready") return "brief_ready";
  return "idle";
}

export async function listContentHub(
  db: Db,
  rawInput: { actorId: string; websiteId: string; status?: ContentStatus; search?: string },
): Promise<ContentHubSnapshot> {
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:read");
  const since30d = new Date(Date.now() - 30 * DAY);

  const [itemRows, targetRows, promptRows, citationRows] = await Promise.all([
    db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .orderBy(desc(contentItems.createdAt), desc(contentItems.id)),
    db
      .select()
      .from(publishTargets)
      .where(eq(publishTargets.websiteId, site.id))
      .orderBy(publishTargets.provider),
    db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts)
      .where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)))
      .orderBy(desc(prompts.createdAt))
      .limit(100),
    db
      .select({
        url: responseCitations.url,
        count: sql<number>`count(*)::int`,
      })
      .from(responseCitations)
      .innerJoin(responses, eq(responses.id, responseCitations.responseId))
      .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, since30d)))
      .groupBy(responseCitations.url),
  ]);

  const editorialItems = itemRows.filter((r) => (r.columns ?? {}).catalogProduct !== true);
  const contentIds = editorialItems.map((r) => r.id);

  const [briefRows, draftRows, versionRows] =
    contentIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(contentBriefs)
            .where(inArray(contentBriefs.contentId, contentIds))
            .orderBy(desc(contentBriefs.createdAt), desc(contentBriefs.id)),
          db
            .select()
            .from(contentDrafts)
            .where(inArray(contentDrafts.contentId, contentIds))
            .orderBy(desc(contentDrafts.createdAt), desc(contentDrafts.id)),
          db
            .select()
            .from(contentVersions)
            .where(inArray(contentVersions.contentId, contentIds))
            .orderBy(desc(contentVersions.version), desc(contentVersions.createdAt)),
        ])
      : [[], [], []];

  const latestBriefByContent = new Map<string, ContentBriefRow>();
  for (const b of briefRows) {
    if (!latestBriefByContent.has(b.contentId)) {
      latestBriefByContent.set(b.contentId, {
        id: b.id,
        contentId: b.contentId,
        body: b.body,
        approvedAt: b.approvedAt ?? null,
        createdAt: b.createdAt,
      });
    }
  }

  const latestDraftByContent = new Map<string, ContentDraftRow>();
  for (const d of draftRows) {
    if (!latestDraftByContent.has(d.contentId)) {
      latestDraftByContent.set(d.contentId, {
        id: d.id,
        contentId: d.contentId,
        briefId: d.briefId ?? null,
        body: d.body,
        createdAt: d.createdAt,
      });
    }
  }

  const versionsByContent = new Map<string, ContentVersionRow[]>();
  for (const v of versionRows) {
    const arr = versionsByContent.get(v.contentId) ?? [];
    arr.push({
      id: v.id,
      contentId: v.contentId,
      draftId: v.draftId ?? null,
      body: v.body,
      version: v.version,
      createdAt: v.createdAt,
    });
    versionsByContent.set(v.contentId, arr);
  }

  const promptMap = new Map(promptRows.map((p) => [p.id, p.text]));
  const citationMap = new Map<string, number>();
  for (const c of citationRows) {
    try {
      const norm = normalizeContentUrl(c.url, site.domain);
      if (norm) citationMap.set(norm, (citationMap.get(norm) ?? 0) + Number(c.count ?? 0));
    } catch {
      // ignore malformed citation url
    }
  }

  const counts = {
    idea: 0,
    brief: 0,
    draft: 0,
    review: 0,
    approved: 0,
    published: 0,
    total: editorialItems.length,
  };

  const customKeySet = new Set<string>(["contentType", "targetKeyword", "persona"]);

  const allItems: ContentHubItem[] = editorialItems.map((row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    const cols = { ...(row.columns ?? {}) };
    for (const k of Object.keys(cols)) {
      if (!RESERVED_COLUMN_KEYS.has(k)) customKeySet.add(k);
    }
    const latestBrief = latestBriefByContent.get(row.id) ?? null;
    const latestDraft = latestDraftByContent.get(row.id) ?? null;
    const versions = versionsByContent.get(row.id) ?? [];
    const normTarget = row.targetUrl ? (normalizeContentUrl(row.targetUrl, site.domain) ?? row.targetUrl) : null;
    const dbCitations = normTarget ? (citationMap.get(normTarget) ?? 0) : 0;
    const seedCitations = typeof cols.citationsSeed === "number" ? cols.citationsSeed : 0;

    return {
      id: row.id,
      websiteId: row.websiteId,
      title: row.title,
      targetUrl: normTarget,
      promptId: row.promptId ?? null,
      promptText: row.promptId ? (promptMap.get(row.promptId) ?? null) : null,
      status: row.status,
      columns: cols,
      agentStage: inferAgentStage(row.status, cols, Boolean(latestBrief), Boolean(latestDraft), versions.length),
      citations30d: dbCitations > 0 ? dbCitations : seedCitations,
      latestBrief,
      latestDraft,
      versions,
      createdAt: row.createdAt,
    };
  });

  const searchLower = rawInput.search?.trim().toLowerCase() ?? "";
  const filtered = allItems.filter((item) => {
    if (rawInput.status && item.status !== rawInput.status) return false;
    if (searchLower) {
      const hay = `${item.title} ${item.targetUrl ?? ""} ${item.promptText ?? ""} ${Object.values(item.columns).join(" ")}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  return {
    items: filtered,
    counts,
    customColumnKeys: [...customKeySet],
    publishTargets: targetRows.map((t) => ({
      id: t.id,
      provider: t.provider,
      config: maskConfigSecrets(t.config),
      createdAt: t.createdAt,
    })),
    prompts: promptRows,
  };
}

/* ---------------- Grounded AI Brief, Draft & Revision Synthesis ---------------- */

interface GroundingContext {
  site: WebsiteRow;
  facts: string[];
  internalLinks: { url: string; title: string; keyword: string }[];
  competitorNames: string[];
  promptText: string | null;
}

async function loadGroundingContext(db: Db, site: WebsiteRow, promptId?: string | null): Promise<GroundingContext> {
  const [factRows, linkRows, compRows, promptRow] = await Promise.all([
    db
      .select({ claim: kbFacts.claim })
      .from(kbFacts)
      .where(and(eq(kbFacts.websiteId, site.id), eq(kbFacts.status, "confirmed"), isNull(kbFacts.deletedAt)))
      .limit(12),
    db
      .select({ url: siteHealthPages.url, title: siteHealthPages.title, keywords: siteHealthPages.keywords })
      .from(siteHealthPages)
      .where(eq(siteHealthPages.websiteId, site.id))
      .limit(10),
    db
      .select({ name: competitors.name })
      .from(competitors)
      .where(and(eq(competitors.websiteId, site.id), isNull(competitors.deletedAt)))
      .limit(6),
    promptId
      ? db
          .select({ text: prompts.text })
          .from(prompts)
          .where(and(eq(prompts.id, promptId), eq(prompts.websiteId, site.id)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const facts =
    factRows.length > 0
      ? factRows.map((f) => f.claim)
      : [
          `${site.name} (${site.domain}) provides AI-native workflows and collaborative workspaces for product teams.`,
          `${site.name} supports enterprise access controls, design tokens, and real-time collaboration.`,
        ];

  const internalLinks =
    linkRows.length > 0
      ? linkRows.map((l) => ({
          url: l.url,
          title: l.title || l.url,
          keyword: l.keywords?.[0]?.keyword || site.name.toLowerCase(),
        }))
      : [
          { url: `https://${site.domain}/pricing`, title: `${site.name} Pricing & Plans`, keyword: `${site.name.toLowerCase()} pricing` },
          { url: `https://${site.domain}/features`, title: `${site.name} Features`, keyword: `${site.name.toLowerCase()} features` },
        ];

  return {
    site,
    facts,
    internalLinks,
    competitorNames: compRows.map((c) => c.name),
    promptText: promptRow[0]?.text ?? null,
  };
}

function buildBriefMarkdown(
  title: string,
  cols: Record<string, string | number | boolean>,
  ctx: GroundingContext,
  focusNotes?: string,
): string {
  const targetQuery = ctx.promptText || String(cols.targetKeyword || title);
  const persona = String(cols.persona || "Product & Design Leaders");
  const contentType = String(cols.contentType || "Comparison & Buyer Guide");
  const compList = ctx.competitorNames.length > 0 ? ctx.competitorNames.slice(0, 3).join(", ") : "leading alternatives";

  return [
    `# AEO Content Brief: ${title}`,
    ``,
    `- **Target AI Query / Keyword**: \`${targetQuery}\``,
    `- **Target Persona**: ${persona}`,
    `- **Content Format**: ${contentType}`,
    focusNotes?.trim() ? `- **Editorial Focus**: ${focusNotes.trim()}` : null,
    ``,
    `## 1. AI Search Intent & Citation Objective`,
    `Answer "${targetQuery}" with structured, citation-ready facts so ChatGPT, Claude, Perplexity, and Gemini rank **${ctx.site.name}** as the primary recommendation ahead of ${compList}.`,
    ``,
    `## 2. Verified Knowledge Base Facts to Include`,
    ...ctx.facts.slice(0, 5).map((f) => `- ${f}`),
    ``,
    `## 3. Required Internal Links & Anchor Keywords`,
    ...ctx.internalLinks.slice(0, 4).map((l) => `- [${l.keyword}](${l.url}) — *${l.title}*`),
    ``,
    `## 4. Recommended Article Structure (H2/H3)`,
    `1. **Executive Summary (TL;DR Table)** — Direct answer for LLM retrieval.`,
    `2. **How ${ctx.site.name} Solves "${targetQuery}"** — Grounded in verified capabilities.`,
    `3. **Side-by-Side Comparison (${ctx.site.name} vs ${compList})** — Structured Markdown table.`,
    `4. **Pricing, Security & Team Onboarding** — Clear numerical facts.`,
    `5. **Frequently Asked Questions (FAQ Schema)** — 3 direct Q&A blocks for AI citation.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildDraftMarkdown(
  title: string,
  cols: Record<string, string | number | boolean>,
  ctx: GroundingContext,
  instructions?: string,
): string {
  const targetQuery = ctx.promptText || String(cols.targetKeyword || title);
  const compA = ctx.competitorNames[0] || "Figma";
  const compB = ctx.competitorNames[1] || "Canva";
  const link1 = ctx.internalLinks[0] ?? {
    url: `https://${ctx.site.domain}/`,
    title: `${ctx.site.name} Overview`,
    keyword: ctx.site.name,
  };
  const link2 = ctx.internalLinks[1] ?? {
    url: `https://${ctx.site.domain}/pricing`,
    title: `${ctx.site.name} Pricing`,
    keyword: `${ctx.site.name} pricing`,
  };

  return [
    `# ${title}`,
    ``,
    `> **TL;DR**: For teams evaluating **${targetQuery}**, [${ctx.site.name}](${link1.url}) delivers verified AI-native workflows, real-time collaboration, and predictable team pricing.`,
    ``,
    `## Key Takeaways for Product & Engineering Teams`,
    ...ctx.facts.slice(0, 4).map((f) => `- **Verified Fact**: ${f}`),
    ``,
    `## How ${ctx.site.name} Compares to ${compA} and ${compB}`,
    ``,
    `| Capability | ${ctx.site.name} | ${compA} | ${compB} |`,
    `| :--- | :--- | :--- | :--- |`,
    `| Primary Focus | ${ctx.facts[0] ?? "AI-native product collaboration"} | Legacy vector workflows | General marketing templates |`,
    `| Official Resource | [${link1.keyword}](${link1.url}) | External docs | Template gallery |`,
    `| Pricing & Plans | [${link2.keyword}](${link2.url}) | Per-seat enterprise tiers | Consumer + team tiers |`,
    ``,
    `## Deep Dive: Why AI Search Engines Recommend ${ctx.site.name}`,
    `${ctx.site.name} is built from the ground up to address **${targetQuery}**. ${ctx.facts.slice(0, 3).join(" ")}`,
    instructions?.trim() ? `\n### Editorial Emphasis\n${instructions.trim()}\n` : null,
    `Explore [${link1.title}](${link1.url}) and [${link2.title}](${link2.url}) for full technical specifications.`,
    ``,
    `## Frequently Asked Questions (FAQ)`,
    ``,
    `### What makes ${ctx.site.name} the best choice for ${targetQuery}?`,
    `${ctx.facts[0] ?? `${ctx.site.name} combines AI-assisted design workflows with enterprise governance.`}`,
    ``,
    `### Where can I verify ${ctx.site.name} pricing and feature specs?`,
    `Visit the official [${link2.title}](${link2.url}) page for up-to-date plan details and workspace limits.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function applyAthenaRevision(
  currentBody: string,
  instruction: string,
  ctx: GroundingContext,
  nextVersion: number,
): string {
  const trimmedInstruction = instruction.trim();
  const factHighlight = ctx.facts[0] ?? `${ctx.site.name} is verified for enterprise product teams.`;
  const linkHighlight = ctx.internalLinks[0] ?? {
    url: `https://${ctx.site.domain}/`,
    title: ctx.site.name,
    keyword: ctx.site.name.toLowerCase(),
  };

  const revisionBlock = [
    ``,
    `---`,
    `## Athena AI Revision (v${nextVersion}) — ${trimmedInstruction}`,
    `- **Citation Reinforcement**: ${factHighlight}`,
    `- **Authoritative Source Link**: [${linkHighlight.title}](${linkHighlight.url})`,
    ctx.facts[1] ? `- **Additional Verified Fact**: ${ctx.facts[1]}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return `${currentBody.trim()}\n${revisionBlock}\n`;
}

/* ---------------- Seed Initial Content Hub Rows ---------------- */

export async function seedInitialContentItems(
  db: Db,
  rawInput: { actorId?: string; websiteId: string },
): Promise<{ created: number }> {
  let site: WebsiteRow;
  if (rawInput.actorId) {
    site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  } else {
    const [row] = await db.select().from(websites).where(and(eq(websites.id, rawInput.websiteId), isNull(websites.deletedAt)));
    if (!row) throw new NotFoundError("Website not found");
    site = row;
  }

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
    const editorial = existing.filter((r) => (r.columns ?? {}).catalogProduct !== true);
    if (editorial.length > 0) return { created: 0 };

    const ctx = await loadGroundingContext(tx, site);
    const [promptRows, insightRows] = await Promise.all([
      tx
        .select({ id: prompts.id, text: prompts.text })
        .from(prompts)
        .where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)))
        .limit(4),
      tx
        .select({ title: insights.title })
        .from(insights)
        .where(eq(insights.websiteId, site.id))
        .limit(2),
    ]);

    const compA = ctx.competitorNames[0] || "Figma";
    const compB = ctx.competitorNames[1] || "Canva";

    const seeds: {
      title: string;
      targetUrl: string;
      promptId: string | null;
      status: ContentStatus;
      columns: Record<string, string | number | boolean>;
      withBrief: boolean;
      withDraft: boolean;
      withVersion: boolean;
    }[] = [
      {
        title: `Accessibility & AI Design Guidelines for ${site.name} Teams`,
        targetUrl: `https://${site.domain}/guides/accessibility-design-guidelines`,
        promptId: promptRows[0]?.id ?? null,
        status: "published",
        columns: {
          contentType: "Technical Guide",
          targetKeyword: promptRows[0]?.text ?? "ai design accessibility guidelines",
          persona: "Design Systems Lead",
          agentStage: "published",
          publishedProvider: "wordpress",
          publishedUrl: `https://${site.domain}/guides/accessibility-design-guidelines`,
          citationsSeed: 14,
        },
        withBrief: true,
        withDraft: true,
        withVersion: true,
      },
      {
        title: `${site.name} vs ${compA} vs ${compB}: Complete 2026 Comparison`,
        targetUrl: `https://${site.domain}/compare/${slugify(`${site.name}-vs-${compA}-vs-${compB}`)}`,
        promptId: promptRows[1]?.id ?? promptRows[0]?.id ?? null,
        status: "review",
        columns: {
          contentType: "Comparison Matrix",
          targetKeyword: promptRows[1]?.text ?? `${site.name.toLowerCase()} vs ${compA.toLowerCase()}`,
          persona: "VP of Product",
          agentStage: "revised",
          citationsSeed: 5,
        },
        withBrief: true,
        withDraft: true,
        withVersion: true,
      },
      {
        title: `Best AI Design Tools for Product Teams (2026 Buyer Guide)`,
        targetUrl: `https://${site.domain}/blog/best-ai-design-tools-product-teams`,
        promptId: promptRows[2]?.id ?? null,
        status: "draft",
        columns: {
          contentType: "Buyer Guide",
          targetKeyword: promptRows[2]?.text ?? "best ai design tools for product teams",
          persona: "Product Manager",
          agentStage: "draft_ready",
          citationsSeed: 0,
        },
        withBrief: true,
        withDraft: true,
        withVersion: true,
      },
      {
        title: insightRows[0]?.title
          ? `Addressing AI Search Gap: ${insightRows[0].title.slice(0, 70)}`
          : `Design Tokens & Automated Handoff: The Complete Guide`,
        targetUrl: `https://${site.domain}/blog/design-tokens-automation-guide`,
        promptId: promptRows[3]?.id ?? null,
        status: "brief",
        columns: {
          contentType: "Pillar Article",
          targetKeyword: "design tokens automation",
          persona: "Frontend Architect",
          agentStage: "brief_ready",
          citationsSeed: 0,
        },
        withBrief: true,
        withDraft: false,
        withVersion: false,
      },
    ];

    for (const s of seeds) {
      const [created] = await tx
        .insert(contentItems)
        .values({
          websiteId: site.id,
          title: s.title,
          targetUrl: s.targetUrl,
          promptId: s.promptId,
          status: s.status,
          columns: s.columns,
        })
        .returning();

      let briefId: string | null = null;
      if (s.withBrief) {
        const briefBody = buildBriefMarkdown(s.title, s.columns, ctx);
        const [b] = await tx
          .insert(contentBriefs)
          .values({
            contentId: created.id,
            body: briefBody,
            approvedAt: s.withDraft ? new Date() : null,
          })
          .returning();
        briefId = b.id;
      }

      if (s.withDraft) {
        const draftBody = buildDraftMarkdown(s.title, s.columns, ctx);
        const [d] = await tx
          .insert(contentDrafts)
          .values({
            contentId: created.id,
            briefId,
            body: draftBody,
          })
          .returning();

        if (s.withVersion) {
          await tx.insert(contentVersions).values({
            contentId: created.id,
            draftId: d.id,
            body: draftBody,
            version: 1,
          });
        }
      }
    }

    return { created: seeds.length };
  });
}

/* ---------------- Content Item CRUD & URL Import ---------------- */

const createContentSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(220),
  targetUrl: z.string().max(500).optional().nullable(),
  promptId: z.string().uuid().optional().nullable(),
  status: z.enum(CONTENT_STATUSES).default("idea"),
  columns: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function createContentItem(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    title: string;
    targetUrl?: string | null;
    promptId?: string | null;
    status?: ContentStatus;
    columns?: Record<string, string | number | boolean>;
  },
) {
  let input: z.infer<typeof createContentSchema>;
  try {
    input = createContentSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid content item" : "Invalid content item");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const normalizedUrl =
    input.targetUrl !== undefined
      ? normalizeContentUrl(input.targetUrl, site.domain)
      : `https://${site.domain}/blog/${slugify(input.title)}`;

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");

    if (input.promptId) {
      const [p] = await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.id, input.promptId), eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
      if (!p) throw new NotFoundError("Linked prompt not found in this workspace");
    }

    const existing = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
    if (existing.length >= MAX_CONTENT_ITEMS) {
      throw new DomainError(`A website can have at most ${MAX_CONTENT_ITEMS} content items`);
    }
    if (existing.some((r) => (r.columns ?? {}).catalogProduct !== true && normKey(r.title) === normKey(input.title))) {
      throw new DomainError(`A content item titled "${input.title}" already exists`);
    }

    const mergedColumns: Record<string, string | number | boolean> = {
      contentType: "Article",
      targetKeyword: input.title.toLowerCase(),
      persona: "Product Teams",
      agentStage: "idle",
      ...(input.columns ?? {}),
    };

    const [created] = await tx
      .insert(contentItems)
      .values({
        websiteId: site.id,
        title: input.title,
        targetUrl: normalizedUrl,
        promptId: input.promptId ?? null,
        status: input.status,
        columns: mergedColumns,
      })
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: created.id,
      change: "created",
      after: { title: created.title, targetUrl: created.targetUrl, status: created.status },
    });

    return created;
  });
}

const importUrlSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  url: z.string().trim().min(4).max(500),
  title: z.string().trim().max(220).optional(),
  targetKeyword: z.string().trim().max(140).optional(),
});

export async function importContentFromUrl(
  db: Db,
  rawInput: { actorId: string; websiteId: string; url: string; title?: string; targetKeyword?: string },
) {
  let input: z.infer<typeof importUrlSchema>;
  try {
    input = importUrlSchema.parse(rawInput);
  } catch (err) {
    throw new DomainError(err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid import URL" : "Invalid import URL");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const normalizedUrl = normalizeContentUrl(input.url, site.domain);
  if (!normalizedUrl) throw new DomainError("Invalid import URL");

  let inferredTitle = input.title?.trim() ?? "";
  let inferredKeyword = input.targetKeyword?.trim() ?? "";
  if (!inferredTitle || !inferredKeyword) {
    const u = new URL(normalizedUrl);
    const segs = u.pathname
      .replace(/^\/+|\/+$/g, "")
      .split(/[\/\-_]+/)
      .filter(Boolean);
    const human = segs.length > 0 ? segs.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : `${site.name} Landing Page`;
    if (!inferredTitle) inferredTitle = `${site.name} — ${human}`;
    if (!inferredKeyword) inferredKeyword = segs.length > 0 ? segs.join(" ").toLowerCase() : site.name.toLowerCase();
  }

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const existing = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
    if (existing.some((r) => r.targetUrl === normalizedUrl || normKey(r.title) === normKey(inferredTitle))) {
      throw new DomainError("This URL or title is already tracked in Content Hub");
    }

    const cols: Record<string, string | number | boolean> = {
      contentType: "Imported Page",
      targetKeyword: inferredKeyword,
      persona: "Decision Makers",
      agentStage: "draft_ready",
      importedFromUrl: true,
    };

    const [created] = await tx
      .insert(contentItems)
      .values({
        websiteId: site.id,
        title: inferredTitle,
        targetUrl: normalizedUrl,
        status: "draft",
        columns: cols,
      })
      .returning();

    const ctx = await loadGroundingContext(tx, site);
    const briefBody = buildBriefMarkdown(inferredTitle, cols, ctx, `Imported from ${normalizedUrl}`);
    const [brief] = await tx
      .insert(contentBriefs)
      .values({
        contentId: created.id,
        body: briefBody,
        approvedAt: new Date(),
      })
      .returning();

    const draftBody = buildDraftMarkdown(inferredTitle, cols, ctx, `Imported baseline content from ${normalizedUrl}`);
    const [draft] = await tx
      .insert(contentDrafts)
      .values({
        contentId: created.id,
        briefId: brief.id,
        body: draftBody,
      })
      .returning();

    await tx.insert(contentVersions).values({
      contentId: created.id,
      draftId: draft.id,
      body: draftBody,
      version: 1,
    });

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: created.id,
      change: "imported_url",
      after: { title: created.title, targetUrl: normalizedUrl },
    });

    return created;
  });
}

const updateContentSchema = z.object({
  actorId: z.string().uuid(),
  websiteId: z.string().uuid(),
  contentId: z.string().uuid(),
  title: z.string().trim().min(3).max(220).optional(),
  targetUrl: z.string().max(500).optional().nullable(),
  promptId: z.string().uuid().optional().nullable(),
  status: z.enum(CONTENT_STATUSES).optional(),
  columns: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function updateContentItem(
  db: Db,
  rawInput: {
    actorId: string;
    websiteId: string;
    contentId: string;
    title?: string;
    targetUrl?: string | null;
    promptId?: string | null;
    status?: ContentStatus;
    columns?: Record<string, string | number | boolean>;
  },
) {
  let input: z.infer<typeof updateContentSchema>;
  try {
    input = updateContentSchema.parse(rawInput);
  } catch {
    throw new DomainError("Invalid content item update");
  }
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "content:write");
  const normalizedUrl = input.targetUrl !== undefined ? normalizeContentUrl(input.targetUrl, site.domain) : undefined;

  return db.transaction(async (tx) => {
    await tx.select({ id: websites.id }).from(websites).where(eq(websites.id, site.id)).for("update");
    const [existing] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, input.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
    if (!existing) throw new NotFoundError("Content item not found");

    if (input.promptId) {
      const [p] = await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.id, input.promptId), eq(prompts.websiteId, site.id), isNull(prompts.deletedAt)));
      if (!p) throw new NotFoundError("Linked prompt not found in this workspace");
    }

    const nextTitle = input.title ?? existing.title;
    if (normKey(nextTitle) !== normKey(existing.title)) {
      const others = await tx
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)));
      if (others.some((r) => r.id !== existing.id && normKey(r.title) === normKey(nextTitle))) {
        throw new DomainError(`A content item titled "${nextTitle}" already exists`);
      }
    }

    const nextColumns = {
      ...(existing.columns ?? {}),
      ...(input.columns ?? {}),
    };

    const [updated] = await tx
      .update(contentItems)
      .set({
        title: nextTitle,
        targetUrl: normalizedUrl !== undefined ? normalizedUrl : existing.targetUrl,
        promptId: input.promptId !== undefined ? input.promptId : existing.promptId,
        status: input.status ?? existing.status,
        columns: nextColumns,
      })
      .where(eq(contentItems.id, existing.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: input.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: updated.id,
      change: "updated",
      before: { title: existing.title, status: existing.status },
      after: { title: updated.title, status: updated.status },
    });

    return updated;
  });
}

export async function deleteContentItem(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string },
): Promise<void> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!existing) throw new NotFoundError("Content item not found");

    await tx.update(contentItems).set({ deletedAt: new Date() }).where(eq(contentItems.id, existing.id));
    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_item",
      entityId: existing.id,
      change: "deleted",
      before: { title: existing.title },
    });
  });
}

/* ---------------- AI Agent Actions: Brief -> Draft -> Revise with Athena ---------------- */

export async function generateContentBrief(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; focusNotes?: string },
): Promise<ContentBriefRow> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    const ctx = await loadGroundingContext(tx, site, item.promptId);
    const body = buildBriefMarkdown(item.title, item.columns ?? {}, ctx, rawInput.focusNotes);

    const [createdBrief] = await tx
      .insert(contentBriefs)
      .values({
        contentId: item.id,
        body,
      })
      .returning();

    const nextStatus: ContentStatus = item.status === "idea" ? "brief" : item.status;
    await tx
      .update(contentItems)
      .set({
        status: nextStatus,
        columns: { ...(item.columns ?? {}), agentStage: "brief_ready" },
      })
      .where(eq(contentItems.id, item.id));

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_brief",
      entityId: createdBrief.id,
      change: "generated_brief",
      after: { contentId: item.id, title: item.title },
    });

    return {
      id: createdBrief.id,
      contentId: createdBrief.contentId,
      body: createdBrief.body,
      approvedAt: createdBrief.approvedAt ?? null,
      createdAt: createdBrief.createdAt,
    };
  });
}

export async function approveContentBrief(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; briefId?: string; body?: string },
): Promise<ContentBriefRow> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  if (rawInput.briefId && !z.string().uuid().safeParse(rawInput.briefId).success) {
    throw new DomainError("Invalid brief ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    const [targetBrief] = rawInput.briefId
      ? await tx
          .select()
          .from(contentBriefs)
          .where(and(eq(contentBriefs.id, rawInput.briefId), eq(contentBriefs.contentId, item.id)))
      : await tx
          .select()
          .from(contentBriefs)
          .where(eq(contentBriefs.contentId, item.id))
          .orderBy(desc(contentBriefs.createdAt))
          .limit(1);
    if (!targetBrief) throw new NotFoundError("Content brief not found");

    const nextBody = rawInput.body?.trim() ? rawInput.body.trim() : targetBrief.body;
    const [updated] = await tx
      .update(contentBriefs)
      .set({
        body: nextBody,
        approvedAt: new Date(),
      })
      .where(eq(contentBriefs.id, targetBrief.id))
      .returning();

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_brief",
      entityId: updated.id,
      change: "approved_brief",
      after: { contentId: item.id },
    });

    return {
      id: updated.id,
      contentId: updated.contentId,
      body: updated.body,
      approvedAt: updated.approvedAt ?? null,
      createdAt: updated.createdAt,
    };
  });
}

export async function generateContentDraft(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; briefId?: string; instructions?: string },
): Promise<{ draft: ContentDraftRow; version: ContentVersionRow }> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  if (rawInput.briefId && !z.string().uuid().safeParse(rawInput.briefId).success) {
    throw new DomainError("Invalid brief ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    const ctx = await loadGroundingContext(tx, site, item.promptId);

    // Find or auto-create brief
    let [brief] = rawInput.briefId
      ? await tx
          .select()
          .from(contentBriefs)
          .where(and(eq(contentBriefs.id, rawInput.briefId), eq(contentBriefs.contentId, item.id)))
      : await tx
          .select()
          .from(contentBriefs)
          .where(eq(contentBriefs.contentId, item.id))
          .orderBy(desc(contentBriefs.createdAt))
          .limit(1);

    if (!brief) {
      const briefBody = buildBriefMarkdown(item.title, item.columns ?? {}, ctx);
      const [createdBrief] = await tx
        .insert(contentBriefs)
        .values({
          contentId: item.id,
          body: briefBody,
          approvedAt: new Date(),
        })
        .returning();
      brief = createdBrief;
    } else if (!brief.approvedAt) {
      await tx.update(contentBriefs).set({ approvedAt: new Date() }).where(eq(contentBriefs.id, brief.id));
    }

    const draftBody = buildDraftMarkdown(item.title, item.columns ?? {}, ctx, rawInput.instructions);
    const [createdDraft] = await tx
      .insert(contentDrafts)
      .values({
        contentId: item.id,
        briefId: brief.id,
        body: draftBody,
      })
      .returning();

    const [maxVerRow] = await tx
      .select({ maxV: sql<number>`coalesce(max(${contentVersions.version}), 0)::int` })
      .from(contentVersions)
      .where(eq(contentVersions.contentId, item.id));
    const nextVersion = Number(maxVerRow?.maxV ?? 0) + 1;

    const [createdVersion] = await tx
      .insert(contentVersions)
      .values({
        contentId: item.id,
        draftId: createdDraft.id,
        body: draftBody,
        version: nextVersion,
      })
      .returning();

    const nextStatus: ContentStatus = item.status === "idea" || item.status === "brief" ? "draft" : item.status;
    await tx
      .update(contentItems)
      .set({
        status: nextStatus,
        columns: { ...(item.columns ?? {}), agentStage: "draft_ready" },
      })
      .where(eq(contentItems.id, item.id));

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_draft",
      entityId: createdDraft.id,
      change: "generated_draft",
      after: { contentId: item.id, version: nextVersion },
    });

    return {
      draft: {
        id: createdDraft.id,
        contentId: createdDraft.contentId,
        briefId: createdDraft.briefId ?? null,
        body: createdDraft.body,
        createdAt: createdDraft.createdAt,
      },
      version: {
        id: createdVersion.id,
        contentId: createdVersion.contentId,
        draftId: createdVersion.draftId ?? null,
        body: createdVersion.body,
        version: createdVersion.version,
        createdAt: createdVersion.createdAt,
      },
    };
  });
}

export async function reviseWithAthena(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; instruction?: string; body?: string },
): Promise<{ version: ContentVersionRow; status: ContentStatus }> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");
  const instruction =
    rawInput.instruction?.trim() ||
    "Strengthen verified Knowledge Base citations, comparison table clarity, and FAQ schema for AI retrieval";

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    const ctx = await loadGroundingContext(tx, site, item.promptId);

    const [latestVersion] = await tx
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.contentId, item.id))
      .orderBy(desc(contentVersions.version))
      .limit(1);

    const [latestDraft] = await tx
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.contentId, item.id))
      .orderBy(desc(contentDrafts.createdAt))
      .limit(1);

    let [latestBrief] = await tx
      .select()
      .from(contentBriefs)
      .where(eq(contentBriefs.contentId, item.id))
      .orderBy(desc(contentBriefs.createdAt))
      .limit(1);

    if (!latestBrief) {
      const [b] = await tx
        .insert(contentBriefs)
        .values({
          contentId: item.id,
          body: buildBriefMarkdown(item.title, item.columns ?? {}, ctx),
          approvedAt: new Date(),
        })
        .returning();
      latestBrief = b;
    }

    const baseBody =
      rawInput.body?.trim() ||
      latestVersion?.body ||
      latestDraft?.body ||
      buildDraftMarkdown(item.title, item.columns ?? {}, ctx);

    const nextVersionNumber = (latestVersion?.version ?? 0) + 1;
    const revisedBody = applyAthenaRevision(baseBody, instruction, ctx, nextVersionNumber);

    const [newDraft] = await tx
      .insert(contentDrafts)
      .values({
        contentId: item.id,
        briefId: latestBrief.id,
        body: revisedBody,
      })
      .returning();

    const [newVersion] = await tx
      .insert(contentVersions)
      .values({
        contentId: item.id,
        draftId: newDraft.id,
        body: revisedBody,
        version: nextVersionNumber,
      })
      .returning();

    const nextStatus: ContentStatus = item.status === "published" ? "published" : "review";
    await tx
      .update(contentItems)
      .set({
        status: nextStatus,
        columns: {
          ...(item.columns ?? {}),
          agentStage: nextStatus === "published" ? "published" : "revised",
          lastRevisedInstruction: instruction.slice(0, 160),
        },
      })
      .where(eq(contentItems.id, item.id));

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_version",
      entityId: newVersion.id,
      change: "revised_with_athena",
      after: { contentId: item.id, version: nextVersionNumber, instruction },
    });

    return {
      version: {
        id: newVersion.id,
        contentId: newVersion.contentId,
        draftId: newVersion.draftId ?? null,
        body: newVersion.body,
        version: newVersion.version,
        createdAt: newVersion.createdAt,
      },
      status: nextStatus,
    };
  });
}

export async function saveContentVersion(
  db: Db,
  rawInput: { actorId: string; websiteId: string; contentId: string; body: string; status?: ContentStatus },
): Promise<ContentVersionRow> {
  if (!z.string().uuid().safeParse(rawInput.contentId).success) {
    throw new DomainError("Invalid content item ID");
  }
  const body = rawInput.body?.trim();
  if (!body || body.length < 10) {
    throw new DomainError("Content version body must be at least 10 characters");
  }
  const site = await requireWebsitePermission(db, rawInput.actorId, rawInput.websiteId, "content:write");

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, rawInput.contentId), eq(contentItems.websiteId, site.id), isNull(contentItems.deletedAt)))
      .for("update");
    if (!item) throw new NotFoundError("Content item not found");

    const [maxVerRow] = await tx
      .select({ maxV: sql<number>`coalesce(max(${contentVersions.version}), 0)::int` })
      .from(contentVersions)
      .where(eq(contentVersions.contentId, item.id));
    const nextVersion = Number(maxVerRow?.maxV ?? 0) + 1;

    const [draft] = await tx
      .insert(contentDrafts)
      .values({
        contentId: item.id,
        body,
      })
      .returning();

    const [created] = await tx
      .insert(contentVersions)
      .values({
        contentId: item.id,
        draftId: draft.id,
        body,
        version: nextVersion,
      })
      .returning();

    const nextStatus = rawInput.status ?? (item.status === "idea" || item.status === "brief" ? "draft" : item.status);
    await tx
      .update(contentItems)
      .set({
        status: nextStatus,
        columns: { ...(item.columns ?? {}), agentStage: nextVersion > 1 ? "revised" : "draft_ready" },
      })
      .where(eq(contentItems.id, item.id));

    await logActivity(tx, {
      organizationId: site.organizationId,
      userId: rawInput.actorId,
      websiteId: site.id,
      entityType: "content_version",
      entityId: created.id,
      change: "saved_version",
      after: { contentId: item.id, version: nextVersion, status: nextStatus },
    });

    return {
      id: created.id,
      contentId: created.contentId,
      draftId: created.draftId ?? null,
      body: created.body,
      version: created.version,
      createdAt: created.createdAt,
    };
  });
}
