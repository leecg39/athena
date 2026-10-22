import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import {
  responses,
  responseMentions,
  responseCitations,
  runs,
  kbPillars,
  kbFacts,
  oracleFindings,
  customRoles,
  orgMembers,
  websiteMembers,
  users,
  websites,
} from "@athena/db";
import { eq } from "drizzle-orm";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { createPrompt, createTopic } from "../prompts";
import { createCompetitor } from "../competitors";
import { citationRow } from "../sources";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import {
  listKnowledgeBase,
  createPillar,
  updatePillar,
  deletePillar,
  createFact,
  updateFact,
  reviewFact,
  deleteFact,
  extractKnowledgeFacts,
  upsertInternalLink,
  deleteInternalLink,
  syncInternalLinks,
  runOracleScan,
  listOracleFindings,
  updateOracleFindingStatus,
  resolveFindingWithFact,
} from "./index";

describe("knowledge base & oracle", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let orgId: string;
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };
  const NOW = new Date("2026-10-05T12:00:00Z");
  const at = (d: string) => new Date(`${d}T12:00:00Z`);

  beforeAll(async () => {
    t = await createTestDb();
    const u = await ensureUserWithOrg(t.db, { email: "kb@example.com" });
    orgId = u.organizationId;
    const site = await createWebsite(t.db, { organizationId: u.organizationId, userId: u.user.id, domain: "canvasly.io", name: "Canvasly" });
    c = { actorId: u.user.id, websiteId: site.id };

    await t.db
      .update(websites)
      .set({
        profile: {
          description: "Canvasly is an AI-native collaborative design platform for product teams.",
          audiences: ["product design teams"],
          differentiators: ["Real-time multiplayer whiteboarding", "SOC 2 Type II certified security"],
          products: ["Canvasly Pro", "Canvasly Enterprise"],
        },
      })
      .where(eq(websites.id, site.id));

    const figma = await createCompetitor(t.db, { ...c, name: "Figma", domain: "figma.com" });
    const topic = await createTopic(t.db, { ...c, name: "Pricing & Plans" });
    const pPricing = await createPrompt(t.db, { ...c, text: "how much does canvasly cost and what is in the free plan", topicId: topic.id });
    const pCompare = await createPrompt(t.db, { ...c, text: "best collaborative design tool for product teams", topicId: topic.id });
    const [run] = await t.db.insert(runs).values({ websiteId: site.id, state: "completed" }).returning();

    const mk = async (o: {
      prompt: string;
      model: string;
      day: string;
      text: string;
      brand: number | null;
      sentiment?: "positive" | "neutral" | "negative" | "mixed";
      figma?: number;
      urls: string[];
    }) => {
      const [r] = await t.db
        .insert(responses)
        .values({
          runId: run.id,
          websiteId: site.id,
          promptId: o.prompt,
          model: o.model,
          rawText: o.text,
          ranAt: at(o.day),
          mentioned: o.brand !== null,
          position: o.brand,
          sentiment: o.sentiment ?? "neutral",
          cited: o.urls.some((u) => u.includes("canvasly.io")),
        })
        .returning();
      if (o.brand !== null) {
        await t.db.insert(responseMentions).values({
          responseId: r.id,
          name: "Canvasly",
          position: o.brand,
          sentiment: o.sentiment ?? "neutral",
        });
      }
      if (o.figma) {
        await t.db.insert(responseMentions).values({
          responseId: r.id,
          competitorId: figma.id,
          name: "Figma",
          position: o.figma,
          sentiment: "positive",
        });
      }
      if (o.urls.length) {
        await t.db.insert(responseCitations).values(o.urls.map((url, i) => ({ responseId: r.id, rank: i, ...citationRow(url, "canvasly.io") })));
      }
    };

    // Stored AI responses with factual claims and disagreements:
    await mk({
      prompt: pPricing.id,
      model: "chatgpt",
      day: "2026-09-20",
      text: "Canvasly Pro pricing starts at $15 per month, and Canvasly free plan is limited to 10 users per workspace.",
      brand: 1,
      sentiment: "neutral",
      urls: ["https://canvasly.io/pricing", "https://canvasly.io/features"],
    });
    await mk({
      prompt: pPricing.id,
      model: "grok",
      day: "2026-09-21",
      text: "Canvasly Pro pricing starts at $29 per month, and Canvasly supports 50 users on the free plan.",
      brand: 1,
      sentiment: "positive",
      urls: ["https://canvasly.io/pricing"],
    });
    await mk({
      prompt: pCompare.id,
      model: "perplexity",
      day: "2026-09-22",
      text: "1. **Canvasly** — top choice for AI design teams, founded in 2021.\n2. **Figma** — established option.",
      brand: 1,
      figma: 2,
      sentiment: "positive",
      urls: ["https://canvasly.io/security"],
    });
    await mk({
      prompt: pCompare.id,
      model: "gemini",
      day: "2026-09-23",
      text: "1. **Figma** — industry leader for product teams. Canvasly does not support real-time multiplayer whiteboarding.",
      brand: 2,
      figma: 1,
      sentiment: "negative",
      urls: ["https://figma.com/enterprise"],
    });

    // Read-only viewer (has websites:read + content:read, no content:write)
    const [viewer] = await t.db.insert(users).values({ email: "kb-viewer@example.com", name: "KB Viewer" }).returning();
    const [role] = await t.db
      .insert(customRoles)
      .values({ organizationId: orgId, name: "KB Reader", permissions: ["websites:read", "content:read"] })
      .returning();
    await t.db.insert(orgMembers).values({ organizationId: orgId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;

    // Outsider in another org
    const o = await ensureUserWithOrg(t.db, { email: "kb-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
    outsider = { actorId: o.user.id, websiteId: oSite.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("manages pillars and facts CRUD + approval queue with validation and cascading soft-delete", async () => {
    const pricing = await createPillar(t.db, {
      ...c,
      name: "Pricing & Plans",
      document: "# Pricing\nCanvasly Pro starts at $29/month and includes 50-person free workspaces.",
    });
    expect(pricing.name).toBe("Pricing & Plans");

    // Duplicate pillar name rejected (case-insensitive)
    await expect(createPillar(t.db, { ...c, name: "  pricing & plans  " })).rejects.toBeInstanceOf(DomainError);

    const updated = await updatePillar(t.db, { ...c, pillarId: pricing.id, name: "Pricing & Tiers", document: "Updated doc" });
    expect(updated.name).toBe("Pricing & Tiers");

    const fConfirmed = await createFact(t.db, {
      ...c,
      pillarId: pricing.id,
      claim: "Canvasly Pro pricing starts at $29 per month",
      sourceUrl: "https://canvasly.io/pricing",
      status: "confirmed",
    });
    expect(fConfirmed.status).toBe("confirmed");

    // Duplicate claim rejected
    await expect(
      createFact(t.db, { ...c, pillarId: pricing.id, claim: "  canvasly pro pricing starts at $29 per month " }),
    ).rejects.toBeInstanceOf(DomainError);

    // Invalid sourceUrl rejected
    await expect(
      createFact(t.db, { ...c, pillarId: pricing.id, claim: "Valid claim", sourceUrl: "javascript:alert(1)" }),
    ).rejects.toBeInstanceOf(DomainError);

    const fPending = await createFact(t.db, {
      ...c,
      pillarId: pricing.id,
      claim: "Canvasly free plan supports 50 users per workspace",
      status: "pending_review",
      confidence: 0.78,
    });
    expect(fPending.status).toBe("pending_review");

    // Approve pending fact (with edited claim)
    const approved = await reviewFact(t.db, {
      ...c,
      factId: fPending.id,
      decision: "confirmed",
      claim: "Canvasly free plan supports 50 users per workspace",
    });
    expect(approved.status).toBe("confirmed");
    expect(approved.confidence).toBe(1);

    // Add and reject another pending fact
    const fReject = await createFact(t.db, {
      ...c,
      pillarId: pricing.id,
      claim: "Unverified rumor about Canvasly",
      status: "pending_review",
    });
    const rejected = await reviewFact(t.db, { ...c, factId: fReject.id, decision: "rejected" });
    expect(rejected.status).toBe("rejected");

    // Soft-deleting a temporary pillar cascades soft-delete to its facts
    const tempPillar = await createPillar(t.db, { ...c, name: "Temp Pillar" });
    const tempFact = await createFact(t.db, { ...c, pillarId: tempPillar.id, claim: "Temp claim to delete" });
    await deletePillar(t.db, { ...c, pillarId: tempPillar.id });

    const [delPillar] = await t.db.select().from(kbPillars).where(eq(kbPillars.id, tempPillar.id));
    const [delFact] = await t.db.select().from(kbFacts).where(eq(kbFacts.id, tempFact.id));
    expect(delPillar.deletedAt).not.toBeNull();
    expect(delFact.deletedAt).not.toBeNull();

    // Update and delete individual fact
    const fEdit = await createFact(t.db, { ...c, pillarId: pricing.id, claim: "Editable claim" });
    const edited = await updateFact(t.db, { ...c, factId: fEdit.id, claim: "Edited claim text", sourceUrl: "https://canvasly.io/docs" });
    expect(edited.claim).toBe("Edited claim text");
    await deleteFact(t.db, { ...c, factId: fEdit.id });
  });

  it("extracts candidate facts from brand profile and AI responses without duplicating existing facts", async () => {
    const firstPass = await extractKnowledgeFacts(t.db, c);
    expect(firstPass.createdFacts).toBeGreaterThanOrEqual(2);

    const secondPass = await extractKnowledgeFacts(t.db, c);
    expect(secondPass.createdFacts).toBe(0);

    const kb = await listKnowledgeBase(t.db, c);
    expect(kb.pillars.length).toBeGreaterThanOrEqual(2);
    expect(kb.counts.confirmed).toBeGreaterThanOrEqual(3);
    expect(kb.counts.pendingReview).toBeGreaterThanOrEqual(1);
  });

  it("manages internal link pages, syncs brand citations, and validates brand domain ownership", async () => {
    const synced = await syncInternalLinks(t.db, c);
    expect(synced.created).toBeGreaterThanOrEqual(2);

    const added = await upsertInternalLink(t.db, {
      ...c,
      url: "https://canvasly.io/enterprise",
      title: "Canvasly Enterprise Security",
      keywords: ["enterprise design", "soc 2", "sso"],
    });
    expect(added.url).toBe("https://canvasly.io/enterprise");
    expect(added.keywords.map((k) => k.keyword)).toEqual(["enterprise design", "soc 2", "sso"]);

    // Rejects external domain URL for internal link page
    await expect(
      upsertInternalLink(t.db, { ...c, url: "https://figma.com/pricing", title: "Figma", keywords: ["figma"] }),
    ).rejects.toBeInstanceOf(DomainError);

    const kb = await listKnowledgeBase(t.db, c);
    const pricingLink = kb.internalLinks.find((l) => l.url === "https://canvasly.io/pricing");
    expect(pricingLink).toBeTruthy();
    expect(pricingLink!.citationCount).toBeGreaterThanOrEqual(2);
    expect(pricingLink!.factCount).toBeGreaterThanOrEqual(1);

    await deleteInternalLink(t.db, { ...c, linkId: added.id });
    const afterDel = await listKnowledgeBase(t.db, c);
    expect(afterDel.internalLinks.map((l) => l.id)).not.toContain(added.id);
  });

  it("scans responses vs KB to detect confirmed_inaccuracy, kb_inconsistency, and model_disagreement, with resolution workflow", async () => {
    // Seed a conflicting KB fact to trigger kb_inconsistency alongside confirmed_inaccuracy and model_disagreement
    const kb = await listKnowledgeBase(t.db, c);
    const companyPillar = kb.pillars[0]!;
    await createFact(t.db, {
      ...c,
      pillarId: companyPillar.id,
      claim: "Canvasly was founded in 2021 by product designers",
      status: "confirmed",
    });
    const conflictingFact = await createFact(t.db, {
      ...c,
      pillarId: companyPillar.id,
      claim: "Canvasly was founded in 2019 in San Francisco",
      status: "confirmed",
    });

    const scan1 = await runOracleScan(t.db, { ...c, now: NOW });
    expect(scan1.created).toBeGreaterThanOrEqual(3);
    const types = new Set(scan1.findings.map((f) => f.type));
    expect(types.has("confirmed_inaccuracy")).toBe(true);
    expect(types.has("kb_inconsistency")).toBe(true);
    expect(types.has("model_disagreement")).toBe(true);

    // Concurrent re-scans serialize and do not duplicate rows
    const [sA, sB] = await Promise.all([
      runOracleScan(t.db, { ...c, now: NOW }),
      runOracleScan(t.db, { ...c, now: NOW }),
    ]);
    expect(sA.created + sB.created).toBe(0);
    const allRows = await t.db.select().from(oracleFindings).where(eq(oracleFindings.websiteId, c.websiteId));
    expect(allRows).toHaveLength(scan1.findings.length);

    // Resolution workflow: open -> resolving -> resolved / dismissed
    const list1 = await listOracleFindings(t.db, c);
    const f1 = list1.rows.find((r) => r.type === "confirmed_inaccuracy") ?? list1.rows[0]!;
    const f2 = list1.rows.find((r) => r.type === "model_disagreement" && r.id !== f1.id) ?? list1.rows[1]!;

    const resolving = await updateOracleFindingStatus(t.db, { ...c, findingId: f1.id, status: "resolving" });
    expect(resolving.status).toBe("resolving");

    const resolvedViaFact = await resolveFindingWithFact(t.db, {
      ...c,
      findingId: f1.id,
      pillarId: companyPillar.id,
      claim: "Canvasly Pro pricing starts at $29 per month with annual billing options",
    });
    expect(resolvedViaFact.finding.status).toBe("resolved");
    expect(resolvedViaFact.fact.status).toBe("confirmed");

    const dismissed = await updateOracleFindingStatus(t.db, { ...c, findingId: f2.id, status: "dismissed" });
    expect(dismissed.status).toBe("dismissed");

    // Re-running scan skips resolved and dismissed findings
    const scanAfterResolve = await runOracleScan(t.db, { ...c, now: NOW });
    expect(scanAfterResolve.skipped).toBeGreaterThanOrEqual(2);

    // Deleting the conflicting fact immediately resolves any open oracle finding linked to it, and re-scanning keeps kb_inconsistency at 0
    await deleteFact(t.db, { ...c, factId: conflictingFact.id });
    await runOracleScan(t.db, { ...c, now: NOW });
    const afterFix = await listOracleFindings(t.db, { ...c, status: "open", type: "kb_inconsistency" });
    expect(afterFix.rows).toHaveLength(0);

    // Resolving a model_disagreement finding with an existing claim updates the existing fact in place without duplicating
    const disagreeList = await listOracleFindings(t.db, { ...c, status: "open", type: "model_disagreement" });
    if (disagreeList.rows.length > 0) {
      const df = disagreeList.rows[0]!;
      const resDup = await resolveFindingWithFact(t.db, {
        ...c,
        findingId: df.id,
        pillarId: companyPillar.id,
        claim: "Canvasly was founded in 2021 by product designers",
      });
      expect(resDup.finding.status).toBe("resolved");
      await updateOracleFindingStatus(t.db, { ...c, findingId: df.id, status: "open" });
    }
  });

  it("enforces tenant isolation and RBAC across KB and Oracle", async () => {
    await expect(listKnowledgeBase(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();
    await expect(listOracleFindings(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();

    await expect(createPillar(t.db, { actorId: viewerId, websiteId: c.websiteId, name: "Blocked" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runOracleScan(t.db, { actorId: viewerId, websiteId: c.websiteId, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);

    await expect(listKnowledgeBase(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOracleFindings(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runOracleScan(t.db, { actorId: outsider.actorId, websiteId: c.websiteId, now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
